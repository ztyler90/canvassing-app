/**
 * KnockIQ — create-portal-session Edge Function
 *
 * Returns a Stripe Billing Portal URL so an org owner can self-serve their
 * billing: update card, view/download invoices, see the current plan. Called
 * from Settings → "Manage billing".
 *
 * Owner-only. The org must already have a Stripe customer (i.e. has been
 * through Checkout at least once).
 *
 * Secrets (mode-aware): STRIPE_MODE, STRIPE_SECRET_KEY_{TEST,LIVE}, APP_BASE_URL.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://app.knockiq.com').replace(/\/$/, '')
const STRIPE_MODE = (Deno.env.get('STRIPE_MODE') || 'live').toLowerCase() === 'test' ? 'test' : 'live'
function stripeEnv(base: string): string {
  const suffix = STRIPE_MODE === 'test' ? '_TEST' : '_LIVE'
  return Deno.env.get(base + suffix) || Deno.env.get(base) || ''
}
const STRIPE_SECRET_KEY = stripeEnv('STRIPE_SECRET_KEY')

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
      .from('organizations').select('id, owner_user_id, stripe_customer_id')
      .eq('id', profile.organization_id).single()
    if (!org || org.owner_user_id !== caller.id) {
      return json({ error: 'Forbidden: only the account owner can manage billing' }, 403)
    }
    if (!org.stripe_customer_id) {
      return json({ error: 'No billing account yet — complete checkout first.' }, 409)
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${APP_BASE_URL}/settings`,
    })

    return json({ url: portal.url })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-portal-session] error:', msg)
    return json({ error: msg }, 500)
  }
})
