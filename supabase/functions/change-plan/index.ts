/**
 * KnockIQ — change-plan Edge Function
 *
 * Self-serve plan switching from Settings → Plans. The owner taps a plan card,
 * confirms, and we move their existing Stripe subscription between the
 * Standard and Pro prices. This is the in-app alternative to the Stripe Billing
 * Portal — same end result, but the confirmation lives in our UI.
 *
 * Owner-only. The org must already have a Stripe subscription (i.e. has been
 * through Checkout). Orgs with no subscription (grandfathered / demo / pricing-
 * bypassed) get a DB-only tier flip — there's no Stripe object to bill, so no
 * charge can happen.
 *
 * Charging rules (deliberately simple and schedule-free, so seat-quantity
 * syncing via manage-team keeps working — a Stripe Subscription Schedule would
 * lock the subscription and break sync_seats):
 *
 *   UPGRADE  (tier standard → pro): swap to the Pro price with
 *            proration_behavior 'create_prorations'. Pro unlocks immediately;
 *            the prorated difference lands on the next invoice. We set
 *            tier='pro' + selected_plan='pro' right away for snappy UI.
 *
 *   DOWNGRADE (tier pro → standard): swap to the Standard price with
 *            proration_behavior 'none' and billing_cycle_anchor 'unchanged'.
 *            No proration/credit. The customer keeps Pro FEATURES until their
 *            next renewal — we leave tier='pro' and only set
 *            selected_plan='standard'. At the next renewal the stripe-webhook
 *            (invoice.payment_succeeded / subscription_cycle) maps the now-
 *            Standard price back to tier='standard'. That's the "at end of
 *            billing cycle" behavior, no schedule required.
 *
 *   UNDO a pending downgrade (tier already pro, target pro): swap back to the
 *            Pro price with proration 'none' — they already paid Pro for this
 *            cycle, so re-selecting Pro must NOT charge a second proration.
 *
 *   TRIAL (status trialing/trial): the org runs on full Pro during the trial
 *            regardless, so we only update selected_plan (what they convert to)
 *            and align the subscription price for the post-trial invoice. No
 *            proration, tier untouched.
 *
 * The charge decision keys off the org's CURRENT tier (what features they have
 * today), NOT the Stripe price — so cancelling a pending downgrade never
 * double-charges.
 *
 * Secrets (mode-aware — see STRIPE_SETUP.md):
 *   STRIPE_MODE                        test | live (default live)
 *   STRIPE_SECRET_KEY_{TEST,LIVE}
 *   STRIPE_PRICE_STANDARD_MONTHLY_{TEST,LIVE}
 *   STRIPE_PRICE_STANDARD_ANNUAL_{TEST,LIVE}
 *   STRIPE_PRICE_PRO_MONTHLY_{TEST,LIVE}
 *   STRIPE_PRICE_PRO_ANNUAL_{TEST,LIVE}
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_MODE = (Deno.env.get('STRIPE_MODE') || 'live').toLowerCase() === 'test' ? 'test' : 'live'
function stripeEnv(base: string): string {
  const suffix = STRIPE_MODE === 'test' ? '_TEST' : '_LIVE'
  return Deno.env.get(base + suffix) || Deno.env.get(base) || ''
}
const STRIPE_SECRET_KEY = stripeEnv('STRIPE_SECRET_KEY')

// Resolve the price id for a plan ('standard'|'pro') + interval ('month'|'year').
// Mirrors create-checkout-session.priceFor exactly.
function priceFor(plan: string, interval: string): string {
  const p = plan === 'pro' ? 'PRO' : 'STANDARD'
  const i = interval === 'year' ? 'ANNUAL' : 'MONTHLY'
  return stripeEnv(`STRIPE_PRICE_${p}_${i}`)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!STRIPE_SECRET_KEY) return json({ error: 'Stripe is not configured on this server' }, 500)
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

    const { data: profile } = await admin
      .from('users').select('role, organization_id').eq('id', caller.id).single()
    if (!profile?.organization_id || profile.role !== 'manager') {
      return json({ error: 'Forbidden: org owner required' }, 403)
    }

    const { data: org } = await admin
      .from('organizations')
      .select('id, owner_user_id, tier, selected_plan, status, stripe_customer_id, stripe_subscription_id')
      .eq('id', profile.organization_id).single()
    if (!org) return json({ error: 'Organization not found' }, 404)
    if (org.owner_user_id !== caller.id) {
      return json({ error: 'Forbidden: only the account owner can change the plan' }, 403)
    }

    // Validate the requested plan.
    const body = await req.json().catch(() => ({}))
    const target = body.plan === 'pro' ? 'pro' : body.plan === 'standard' ? 'standard' : null
    if (!target) return json({ error: 'Invalid plan — must be "standard" or "pro".' }, 400)

    const currentTier = org.tier === 'pro' ? 'pro' : 'standard'
    const inTrial = org.status === 'trial' || org.status === 'trialing'

    // ── No active subscription (grandfathered / demo / pricing-bypassed) ──────
    // Nothing to bill — just flip the org's tier + selected_plan in the DB.
    if (!org.stripe_subscription_id) {
      await admin.from('organizations')
        .update({ tier: target, selected_plan: target })
        .eq('id', org.id)
      return json({ ok: true, applied: 'db_only', plan: target })
    }

    // Pull the live subscription so we can read the current item + interval and
    // preserve whatever billing interval (monthly/annual) they're on.
    const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
    const item = sub.items.data[0]
    if (!item) return json({ error: 'Subscription has no billable item.' }, 409)
    const interval = item.price?.recurring?.interval === 'year' ? 'year' : 'month'
    const targetPrice = priceFor(target, interval)
    if (!targetPrice) return json({ error: `No ${target} price configured for ${interval} billing.` }, 500)

    // Already on the requested plan with nothing pending — no-op.
    if (item.price?.id === targetPrice && org.selected_plan === target && currentTier === target) {
      return json({ ok: true, applied: 'noop', plan: target })
    }

    // ── Trial: only the post-trial plan changes. Align the price so the first
    //    real invoice bills the right plan; never proration during a trial. ──
    if (inTrial) {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: targetPrice }],
        proration_behavior: 'none',
      })
      await admin.from('organizations').update({ selected_plan: target }).eq('id', org.id)
      return json({ ok: true, applied: 'trial', plan: target, trial_end: sub.trial_end || null })
    }

    // ── UPGRADE: only when they don't already have Pro features. Charge the
    //    prorated difference (lands on next invoice); unlock Pro now. ──────────
    if (target === 'pro' && currentTier === 'standard') {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: targetPrice }],
        proration_behavior: 'create_prorations',
      })
      await admin.from('organizations')
        .update({ tier: 'pro', selected_plan: 'pro' })
        .eq('id', org.id)
      return json({ ok: true, applied: 'upgrade_immediate', plan: 'pro' })
    }

    // ── Re-select Pro while already Pro (undo a pending downgrade): swap the
    //    price back with NO proration — they already paid Pro this cycle. ──────
    if (target === 'pro' && currentTier === 'pro') {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: targetPrice }],
        proration_behavior: 'none',
        billing_cycle_anchor: 'unchanged',
      })
      await admin.from('organizations').update({ selected_plan: 'pro' }).eq('id', org.id)
      return json({ ok: true, applied: 'downgrade_cancelled', plan: 'pro' })
    }

    // ── DOWNGRADE (pro → standard): swap price now, no proration, keep the
    //    billing anchor. Features stay Pro (tier untouched) until the next
    //    renewal, where the webhook maps the Standard price → tier='standard'. ─
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: targetPrice }],
      proration_behavior: 'none',
      billing_cycle_anchor: 'unchanged',
    })
    await admin.from('organizations').update({ selected_plan: 'standard' }).eq('id', org.id)
    return json({
      ok: true,
      applied: 'downgrade_scheduled',
      plan: 'standard',
      effective_at: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[change-plan] error:', msg)
    return json({ error: msg }, 500)
  }
})
