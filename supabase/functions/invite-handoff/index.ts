// invite-handoff edge function — redeem a handoff token, mint a fresh
// Supabase magic link RIGHT NOW, return it to the client.
// ──────────────────────────────────────────────────────────────────────
// This function is the back-half of the two-step invite landing flow.
// See supabase/migrations/20260608_invite_handoffs.sql for the why.
//
// Public endpoint (no JWT required) — the handoff_token IS the auth
// credential. It's a server-generated UUID v4 with 122 bits of
// entropy, embedded in the email link. Anyone who possesses it can
// claim the session it points at, same as anyone who possesses an
// email's verify URL today; that's the same risk profile as the
// existing magic-link flow.
//
// Two actions, distinguished by HTTP method on the same URL:
//
//   GET  /functions/v1/invite-handoff?h=<token>
//     PEEK — returns { full_name, org_name, inviter_name, expired,
//                      completed } for the welcome page to render the
//     personalized greeting. No state change.
//
//   POST /functions/v1/invite-handoff   { handoff_token: "..." }
//     REDEEM — validates the handoff, increments redeem_count, calls
//     auth.admin.generateLink({type:'magiclink'}) to mint a fresh
//     Supabase token, returns { action_link } for the client to
//     window.location.href into.
//
// Why magiclink (not invite) at redeem time:
//   The user already exists by the time the rep clicks — manage-team's
//   create action calls generateLink({type:'invite'}) up front to
//   spawn the auth row, and just discards the action_link. At redeem
//   time the user is already in auth.users, so 'invite' would error
//   with "User already registered." 'magiclink' is the correct shape
//   for already-existing users — it signs them in regardless of
//   email-confirmation state, which is exactly what we want.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// Used as the redirectTo on the freshly-minted magiclink — the rep
// lands here after Supabase verifies the token, with the session
// already established (#access_token=...&refresh_token=...).
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://app.knockiq.com').replace(/\/$/, '')

// Hard cap on redemptions per handoff. Real reps tap once. Five
// covers "tapped, closed, tapped again." Beyond that we're either
// looking at a bot or an attacker scraping links.
const MAX_REDEEMS = 5

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function admin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method === 'GET')  return await handlePeek(req)
    if (req.method === 'POST') return await handleRedeem(req)
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (err) {
    console.error('[invite-handoff] unexpected error:', err)
    return jsonResponse({ error: 'Server error. Please try again in a moment.' }, 500)
  }
})

/**
 * GET — render-info-only peek. Returns name + state for the welcome
 * page. NEVER mints a Supabase token; never increments redeem_count.
 * Pre-fetching the welcome URL (which is what email scanners do) hits
 * an HTML page, not this endpoint — the welcome page calls peek only
 * when the JS actually executes in a real browser.
 */
async function handlePeek(req: Request) {
  const url    = new URL(req.url)
  const token  = url.searchParams.get('h') || url.searchParams.get('handoff_token')
  if (!token || !/^[0-9a-f-]{32,36}$/i.test(token)) {
    return jsonResponse({ error: 'Missing or invalid handoff token' }, 400)
  }

  const supabase = admin()
  const { data, error } = await supabase
    .from('invite_handoffs')
    .select('full_name, org_name, inviter_name, expires_at, completed_at, redeem_count')
    .eq('handoff_token', token)
    .maybeSingle()
  if (error) {
    console.warn('[invite-handoff peek] db error:', error.message)
    return jsonResponse({ error: 'Could not look up your invite. Try again.' }, 500)
  }
  if (!data) {
    return jsonResponse({ error: 'not_found', message: 'This invite link is not valid.' }, 404)
  }

  const expired   = new Date(data.expires_at).getTime() < Date.now()
  const completed = !!data.completed_at
  const exhausted = (data.redeem_count || 0) >= MAX_REDEEMS

  return jsonResponse({
    full_name:    data.full_name,
    org_name:     data.org_name,
    inviter_name: data.inviter_name,
    expired,
    completed,
    exhausted,
  })
}

/**
 * POST — redeem. Mints a fresh Supabase magic link and returns its
 * action_link for the client to navigate to. Bumps redeem_count;
 * refuses past MAX_REDEEMS or after completed_at is set.
 */
async function handleRedeem(req: Request) {
  let body: { handoff_token?: string } = {}
  try { body = await req.json() } catch { /* tolerate empty / non-JSON */ }
  const token = body.handoff_token
  if (!token || !/^[0-9a-f-]{32,36}$/i.test(token)) {
    return jsonResponse({ error: 'Missing or invalid handoff token' }, 400)
  }

  const supabase = admin()
  const { data: row, error: lookupErr } = await supabase
    .from('invite_handoffs')
    .select('id, user_id, email, expires_at, completed_at, redeem_count')
    .eq('handoff_token', token)
    .maybeSingle()
  if (lookupErr) {
    console.warn('[invite-handoff redeem] lookup error:', lookupErr.message)
    return jsonResponse({ error: 'Could not look up your invite. Try again.' }, 500)
  }
  if (!row) {
    return jsonResponse({
      error:   'not_found',
      message: 'This invite link is no longer valid. Ask your manager to send a new one.',
    }, 404)
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return jsonResponse({
      error:   'expired',
      message: 'This invite link expired. Ask your manager to send a new one.',
    }, 410)
  }
  if (row.completed_at) {
    return jsonResponse({
      error:   'completed',
      message: 'You\'ve already finished setting up this account. Tap "Sign in" instead.',
    }, 409)
  }
  if ((row.redeem_count || 0) >= MAX_REDEEMS) {
    return jsonResponse({
      error:   'exhausted',
      message: 'This invite has been used too many times. Ask your manager to send a fresh one.',
    }, 429)
  }

  // Mint a fresh Supabase magic link. By the time this returns, the
  // token is valid for ~24h (Supabase default for magiclinks). The
  // client immediately navigates to action_link, so the window between
  // creation and consumption is ~1 second.
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type:  'magiclink',
    email: row.email,
    options: { redirectTo: `${APP_BASE_URL}/set-password` },
  })
  if (linkErr || !linkData?.properties?.action_link) {
    console.warn('[invite-handoff redeem] generateLink failed:', linkErr?.message)
    return jsonResponse({
      error:   'mint_failed',
      message: linkErr?.message || 'Could not create your sign-in link. Try again.',
    }, 502)
  }

  // Audit the redemption. Increment redeem_count BEFORE returning the
  // link so a race condition (rep double-taps) doesn't slip an extra
  // mint past the MAX cap. Best-effort: a failure here doesn't block
  // the rep — they've earned their session.
  await supabase
    .from('invite_handoffs')
    .update({
      redeem_count:     (row.redeem_count || 0) + 1,
      last_redeemed_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  return jsonResponse({
    action_link: linkData.properties.action_link,
  })
}
