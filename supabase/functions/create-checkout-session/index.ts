/**
 * KnockIQ — create-checkout-session Edge Function
 *
 * Hosted Stripe Checkout for the card-up-front signup flow. Called AFTER the
 * org is provisioned (provision_new_organization), by the org owner, to collect
 * a card and start the 14-day reverse-Pro trial.
 *
 * Flow:
 *   1. Auth the caller; confirm they're the owner of an org.
 *   2. Resolve the plan+interval price (mode-aware env).
 *   3. Create or reuse the org's Stripe customer; stamp it on the org.
 *   4. Create a subscription-mode Checkout Session (14-day trial, qty = seats).
 *   5. Return the hosted Checkout URL for the browser to redirect to.
 *
 * The webhook (checkout.session.completed) links the subscription back to the
 * org and releases the CompleteCheckout gate. client_reference_id +
 * subscription metadata both carry organization_id so the webhook can resolve
 * the org even if the customer mapping is somehow missing.
 *
 * Secrets (mode-aware — see STRIPE_MODE in STRIPE_SETUP.md):
 *   STRIPE_MODE                        test | live (default live)
 *   STRIPE_SECRET_KEY_{TEST,LIVE}
 *   STRIPE_PRICE_STANDARD_MONTHLY_{TEST,LIVE}
 *   STRIPE_PRICE_STANDARD_ANNUAL_{TEST,LIVE}
 *   STRIPE_PRICE_PRO_MONTHLY_{TEST,LIVE}
 *   STRIPE_PRICE_PRO_ANNUAL_{TEST,LIVE}
 *   APP_BASE_URL
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://app.knockiq.com').replace(/\/$/, '')

// Mode-aware env resolution, matching the manage-team convention.
const STRIPE_MODE = (Deno.env.get('STRIPE_MODE') || 'live').toLowerCase() === 'test' ? 'test' : 'live'
function stripeEnv(base: string): string {
  const suffix = STRIPE_MODE === 'test' ? '_TEST' : '_LIVE'
  return Deno.env.get(base + suffix) || Deno.env.get(base) || ''
}
const STRIPE_SECRET_KEY = stripeEnv('STRIPE_SECRET_KEY')

// Resolve the price id for a plan ('standard'|'pro') + interval ('month'|'year').
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
      .from('users')
      .select('role, organization_id, full_name, email')
      .eq('id', caller.id)
      .single()
    if (!profile?.organization_id || profile.role !== 'manager') {
      return json({ error: 'Forbidden: org owner required' }, 403)
    }

    const { data: org } = await admin
      .from('organizations')
      .select('id, name, selected_plan, stripe_customer_id, stripe_subscription_id')
      .eq('id', profile.organization_id)
      .single()
    if (!org) return json({ error: 'Organization not found' }, 404)

    // Already subscribed — nothing to do (defensive against double-submit).
    if (org.stripe_subscription_id) {
      return json({ error: 'This organization already has an active subscription.' }, 409)
    }

    const body = await req.json().catch(() => ({}))
    const plan     = (body.plan === 'pro' || body.plan === 'standard') ? body.plan : (org.selected_plan || 'standard')
    const interval = body.interval === 'year' ? 'year' : 'month'
    const price = priceFor(plan, interval)
    if (!price) return json({ error: `No price configured for ${plan}/${interval}` }, 500)

    // Billable seats = owner + active reps (role manager|rep, not pending/rejected).
    // At signup this is 1 (the owner). Closers are not billed as seats.
    const { count: seatCount } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id)
      .in('role', ['manager', 'rep'])
      .not('status', 'in', '("pending","rejected")')
    const quantity = Math.max(1, seatCount || 1)

    // Create or reuse the Stripe customer, and make sure the org has the id
    // stamped BEFORE Checkout so the webhook can always resolve the org.
    let customerId = org.stripe_customer_id as string | null
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email || caller.email || undefined,
        name:  org.name || profile.full_name || undefined,
        metadata: { organization_id: org.id },
      })
      customerId = customer.id
      await admin.from('organizations').update({ stripe_customer_id: customerId }).eq('id', org.id)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: org.id,
      line_items: [{ price, quantity }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { organization_id: org.id, selected_plan: plan, interval },
      },
      // Collect a card even though the trial is free, so day-15 conversion is automatic.
      payment_method_collection: 'always',
      allow_promotion_codes: true,
      metadata: { organization_id: org.id, selected_plan: plan, interval },
      // Return into the APP, not '/' — Vercel rewrites '/' to the marketing
      // page (welcome.html), which looks logged-out. '/manager' serves the SPA,
      // where AuthContext restores the session and the billing gate shows the
      // "Finalizing…" screen (then the dashboard) once the webhook lands.
      success_url: `${APP_BASE_URL}/manager?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_BASE_URL}/manager?checkout=cancel`,
    })

    return json({ url: session.url, session_id: session.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout-session] error:', msg)
    return json({ error: msg }, 500)
  }
})
