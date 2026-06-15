/**
 * KnockIQ — stripe-webhook Edge Function (org-level)
 *
 * Keeps each organization's billing fields in sync with Stripe. Rewritten from
 * the old users-table/Elements model to write to ORGANIZATIONS, which is where
 * tier gating, the reverse trial, and the pause/cancel lifecycle read from.
 *
 * Events handled:
 *   checkout.session.completed     → link customer + subscription onto the org,
 *                                     stamp status + trial_ends_at (this is what
 *                                     releases the CompleteCheckout gate).
 *   customer.subscription.updated  → sync status + trial_ends_at; when the trial
 *                                     converts to 'active', flip org.status
 *                                     trial→active and set tier = selected_plan.
 *   customer.subscription.deleted  → subscription_status = 'canceled'.
 *   invoice.payment_failed         → subscription_status = 'past_due'.
 *   invoice.payment_succeeded      → subscription_status = 'active' (post-trial).
 *
 * Org resolution order: client_reference_id / metadata.organization_id (most
 * reliable, set by create-checkout-session), then stripe_customer_id lookup.
 *
 * Secrets (mode-aware): STRIPE_MODE, STRIPE_SECRET_KEY_{TEST,LIVE},
 *   STRIPE_WEBHOOK_SECRET_{TEST,LIVE}.  NOTE: this function must be deployed
 *   with verify_jwt = false (Stripe calls it with a signature, not a JWT).
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const STRIPE_MODE = (Deno.env.get('STRIPE_MODE') || 'live').toLowerCase() === 'test' ? 'test' : 'live'
function stripeEnv(base: string): string {
  const suffix = STRIPE_MODE === 'test' ? '_TEST' : '_LIVE'
  return Deno.env.get(base + suffix) || Deno.env.get(base) || ''
}
const STRIPE_SECRET_KEY  = stripeEnv('STRIPE_SECRET_KEY')
const WEBHOOK_SECRET     = stripeEnv('STRIPE_WEBHOOK_SECRET')

// Map a Stripe price id back to a plan ('pro' | 'standard'), using the same
// mode-aware env vars create-checkout-session / change-plan resolve prices
// from. This is how a deferred downgrade actually lands: when the renewal
// invoice pays on the now-Standard price, we recognize that price as Standard
// and flip the org's tier. Returns null if the price doesn't match any known
// id (e.g. a legacy/custom price) — callers must treat null as "leave tier
// alone" so we never guess wrong.
function planFromPriceId(priceId: string | null | undefined): 'pro' | 'standard' | null {
  if (!priceId) return null
  const ids = {
    pro: [stripeEnv('STRIPE_PRICE_PRO_MONTHLY'), stripeEnv('STRIPE_PRICE_PRO_ANNUAL')],
    standard: [stripeEnv('STRIPE_PRICE_STANDARD_MONTHLY'), stripeEnv('STRIPE_PRICE_STANDARD_ANNUAL')],
  }
  if (ids.pro.includes(priceId)) return 'pro'
  if (ids.standard.includes(priceId)) return 'standard'
  return null
}

type Admin = ReturnType<typeof createClient>

serve(async (req) => {
  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    console.error('[stripe-webhook] Missing Stripe env vars (mode=' + STRIPE_MODE + ')')
    return new Response('Server misconfigured', { status: 500 })
  }
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing stripe-signature header', { status: 400 })

  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-webhook] Signature verification failed:', msg)
    return new Response(`Webhook signature error: ${msg}`, { status: 400 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const orgId = session.client_reference_id || session.metadata?.organization_id || null
        const customerId = (session.customer as string) || null
        const subId = (session.subscription as string) || null
        let status = 'trialing'
        let trialEndsAt: string | null = null
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId)
          status = sub.status
          if (sub.trial_end) trialEndsAt = new Date(sub.trial_end * 1000).toISOString()
        }
        const updates: Record<string, unknown> = {
          stripe_customer_id:     customerId,
          stripe_subscription_id: subId,
          subscription_status:    status,
        }
        if (trialEndsAt) updates.trial_ends_at = trialEndsAt
        if (orgId) {
          await admin.from('organizations').update(updates).eq('id', orgId)
          console.log('[stripe-webhook] checkout.completed linked org', orgId, subId)
        } else if (customerId) {
          await updateByCustomer(admin, customerId, updates)
        }
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(admin, sub)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await updateByCustomer(admin, sub.customer as string, {
          subscription_status: 'canceled',
        })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        if (invoice.subscription) {
          await updateByCustomer(admin, invoice.customer as string, { subscription_status: 'past_due' })
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        // Ignore the $0 trial-start invoice; only react to real post-trial payments.
        if (invoice.subscription && invoice.billing_reason !== 'subscription_create') {
          const updates: Record<string, unknown> = { subscription_status: 'active' }

          // Renewal is where a deferred plan change takes effect. change-plan
          // swapped the subscription price at downgrade time (no proration), so
          // by the time this renewal invoice pays, the price reflects the plan
          // the owner chose. Re-derive tier from that price and sync it. This
          // is what flips a "downgrade at end of billing cycle" from Pro
          // features to Standard exactly at renewal — and is a no-op for orgs
          // whose price already matches their tier.
          if (invoice.billing_reason === 'subscription_cycle') {
            try {
              const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
              const plan = planFromPriceId(sub.items.data[0]?.price?.id)
              if (plan) {
                updates.tier = plan
                updates.selected_plan = plan
              }
            } catch (err) {
              // Non-fatal: if we can't resolve the price, leave tier untouched
              // rather than guess. Status still syncs to 'active'.
              console.warn('[stripe-webhook] could not derive tier at renewal:', err instanceof Error ? err.message : String(err))
            }
          }

          await updateByCustomer(admin, invoice.customer as string, updates)
        }
        break
      }

      default:
        console.log('[stripe-webhook] Ignoring event:', event.type)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stripe-webhook] Handler error:', msg)
    return new Response('Handler error', { status: 500 }) // 500 → Stripe retries
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})

// Sync a subscription's status onto its org. When the trial converts to a
// paying subscription ('active'), flip the org out of the reverse-Pro trial
// onto its selected plan — but only if it's currently in 'trial' so we never
// stomp a paused/cancelled lifecycle state set by the app.
async function syncSubscription(admin: Admin, sub: Stripe.Subscription) {
  const customerId = sub.customer as string
  const { data: org } = await admin
    .from('organizations')
    .select('id, status, selected_plan')
    .eq('stripe_customer_id', customerId)
    .single()
  if (!org) {
    console.warn('[stripe-webhook] no org for customer', customerId)
    return
  }

  const updates: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status:    sub.status,
  }
  if (sub.trial_end) updates.trial_ends_at = new Date(sub.trial_end * 1000).toISOString()

  // Trial → paying conversion: leave 'paused'/'cancelled' untouched.
  if (sub.status === 'active' && org.status === 'trial') {
    updates.status = 'active'
    updates.tier   = org.selected_plan === 'pro' ? 'pro' : 'standard'
  }

  const { error } = await admin.from('organizations').update(updates).eq('id', org.id)
  if (error) throw error
  console.log('[stripe-webhook] synced org', org.id, sub.status)
}

async function updateByCustomer(admin: Admin, customerId: string, updates: Record<string, unknown>) {
  const { error } = await admin.from('organizations').update(updates).eq('stripe_customer_id', customerId)
  if (error) {
    console.error('[stripe-webhook] update failed for customer', customerId, error.message)
    throw error
  }
}
