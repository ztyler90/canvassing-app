/**
 * KnockIQ — stripe-webhook Edge Function
 *
 * Listens for Stripe events and keeps public.users.subscription_status
 * in sync with the real Stripe state.
 *
 * Events handled:
 *   customer.subscription.updated  → sync status + trial_ends_at
 *   customer.subscription.deleted  → mark canceled
 *   invoice.payment_failed         → mark past_due
 *   invoice.payment_succeeded      → mark active (clears past_due)
 *
 * Required environment secrets:
 *   STRIPE_SECRET_KEY          — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET      — whsec_... (from Stripe dashboard webhook config)
 *   SUPABASE_URL               — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY  — auto-injected
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

serve(async (req: Request) => {
  const stripeKey     = Deno.env.get("STRIPE_SECRET_KEY")!;
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  if (!stripeKey || !webhookSecret) {
    console.error("[stripe-webhook] Missing Stripe env vars");
    return new Response("Server misconfigured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

  // ── Verify Stripe signature ────────────────────────────────────────────────
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] Signature verification failed:", msg);
    return new Response(`Webhook signature error: ${msg}`, { status: 400 });
  }

  // ── Supabase client (service role) ────────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── Route events ──────────────────────────────────────────────────────────
  try {
    switch (event.type) {

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(supabase, sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await updateByCustomer(supabase, sub.customer as string, {
          subscription_status:    "canceled",
          stripe_subscription_id: sub.id,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          await updateByCustomer(supabase, invoice.customer as string, {
            subscription_status: "past_due",
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription && invoice.billing_reason !== "subscription_create") {
          // Only update to 'active' after the trial ends and first real payment succeeds.
          // (subscription_create fires at signup even during trial — ignore it.)
          await updateByCustomer(supabase, invoice.customer as string, {
            subscription_status: "active",
          });
        }
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt so Stripe doesn't retry
        console.log("[stripe-webhook] Ignoring event:", event.type);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] Handler error:", msg);
    // Return 500 so Stripe retries the webhook
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function syncSubscription(
  supabase: ReturnType<typeof createClient>,
  sub: Stripe.Subscription
) {
  const updates: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status:    sub.status,
  };

  if (sub.trial_end) {
    updates.trial_ends_at = new Date(sub.trial_end * 1000).toISOString();
  }

  await updateByCustomer(supabase, sub.customer as string, updates);
}

async function updateByCustomer(
  supabase: ReturnType<typeof createClient>,
  customerId: string,
  updates: Record<string, unknown>
) {
  const { error } = await supabase
    .from("users")
    .update(updates)
    .eq("stripe_customer_id", customerId);

  if (error) {
    console.error("[stripe-webhook] DB update failed for customer", customerId, error.message);
    throw error;
  }

  console.log("[stripe-webhook] Updated user for customer", customerId, updates);
}
