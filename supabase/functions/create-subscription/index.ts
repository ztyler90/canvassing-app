/**
 * KnockIQ — create-subscription Edge Function
 *
 * Called by the signup form BEFORE the Supabase user is created.
 * Flow:
 *   1. Validate inputs
 *   2. Create Stripe Customer
 *   3. Attach PaymentMethod as default
 *   4. Create Stripe Subscription with trial_period_days: 7
 *   5. Create Supabase auth user (service role, email_confirm: false)
 *   6. Update public.users row with Stripe IDs + trial info
 *   7. Return success → frontend signs the user in immediately
 *
 * Required environment secrets (set via `supabase secrets set`):
 *   STRIPE_SECRET_KEY          — sk_live_... or sk_test_...
 *   STRIPE_PRICE_ID            — price_... (your monthly plan price ID)
 *   SUPABASE_URL               — auto-injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY  — auto-injected by Supabase
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, password, full_name, payment_method_id } = await req.json();

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!email || !password || !full_name || !payment_method_id) {
      return errorResponse(400, "Missing required fields: email, password, full_name, payment_method_id");
    }
    if (password.length < 6) {
      return errorResponse(400, "Password must be at least 6 characters");
    }

    // ── Initialise clients ────────────────────────────────────────────────────
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId   = Deno.env.get("STRIPE_PRICE_ID");

    if (!stripeKey || !priceId) {
      return errorResponse(500, "Stripe is not configured on this server");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 1. Create Stripe Customer ─────────────────────────────────────────────
    const customer = await stripe.customers.create({
      email,
      name: full_name,
      payment_method: payment_method_id,
      invoice_settings: { default_payment_method: payment_method_id },
    });

    // ── 2. Create Subscription with 7-day trial ───────────────────────────────
    //    Card is saved but NOT charged until day 8.
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: 7,
      default_payment_method: payment_method_id,
      expand: ["latest_invoice.payment_intent"],
    });

    const trialEndsAt = new Date(subscription.trial_end! * 1000).toISOString();

    // ── 3. Create Supabase auth user ──────────────────────────────────────────
    //    Using admin API so we can skip email confirmation.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,             // skip confirmation email
      user_metadata: { full_name },
    });

    if (authError) {
      // Roll back Stripe subscription if user creation fails
      await stripe.subscriptions.cancel(subscription.id).catch(() => {});
      await stripe.customers.del(customer.id).catch(() => {});

      // Surface duplicate-email error clearly
      if (authError.message.includes("already been registered")) {
        return errorResponse(409, "An account with that email already exists.");
      }
      return errorResponse(500, `Account creation failed: ${authError.message}`);
    }

    const userId = authData.user!.id;

    // ── 4. Update public.users profile with Stripe data ───────────────────────
    //    The handle_new_user trigger has already inserted the row.
    const { error: updateError } = await supabase
      .from("users")
      .update({
        stripe_customer_id:     customer.id,
        stripe_subscription_id: subscription.id,
        subscription_status:    subscription.status,   // 'trialing'
        trial_ends_at:          trialEndsAt,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to update user billing fields:", updateError.message);
      // Non-fatal — user + subscription were created. Webhook will sync status.
    }

    // ── 5. Return success ─────────────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        trial_ends_at: trialEndsAt,
        subscription_status: subscription.status,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[create-subscription] Unhandled error:", message);

    // Stripe card errors are user-facing
    if ((err as { type?: string }).type === "StripeCardError") {
      return errorResponse(402, message);
    }
    return errorResponse(500, "An unexpected error occurred. Please try again.");
  }
});

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
