import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { sendEmail, escapeHtml, escapeAttr } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Runtime config ──────────────────────────────────────────────────────────
// Transactional email (Resend) now lives in ../_shared/email.ts — sendEmail
// reads RESEND_API_KEY / RESEND_FROM itself and no-ops with { ok:false } when
// the key is missing, so local dev can still exercise the create-rep flow.
// APP_BASE_URL: used as the `redirectTo` target on the invite link — the
// rep lands on this URL after clicking the email link, which routes them
// to the /set-password screen where they pick their password.
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://app.knockiq.com').replace(/\/$/, '')

// ── Stripe (org lifecycle billing) ───────────────────────────────────────────
// Mode-aware so you can exercise the pause/cancel flow against TEST Stripe
// before flipping to LIVE. STRIPE_MODE picks which key + keep-warm price the
// function uses:
//
//   STRIPE_MODE = 'test'  → STRIPE_SECRET_KEY_TEST  + STRIPE_PRICE_KEEPWARM_TEST
//   STRIPE_MODE = 'live'  → STRIPE_SECRET_KEY_LIVE  + STRIPE_PRICE_KEEPWARM_LIVE
//   (default 'live')
//
// Each mode-specific name falls back to the un-suffixed STRIPE_SECRET_KEY /
// STRIPE_PRICE_KEEPWARM, so an existing single-key setup keeps working.
// When the resolved key is empty, every lifecycle action degrades gracefully
// to a status-only change (no Stripe call) — which is the case before the
// checkout flow exists and orgs actually have subscriptions.
const STRIPE_MODE = (Deno.env.get('STRIPE_MODE') || 'live').toLowerCase() === 'test' ? 'test' : 'live'
function stripeEnv(base: string): string {
  const suffix = STRIPE_MODE === 'test' ? '_TEST' : '_LIVE'
  return Deno.env.get(base + suffix) || Deno.env.get(base) || ''
}
const STRIPE_SECRET_KEY     = stripeEnv('STRIPE_SECRET_KEY')
const STRIPE_PRICE_KEEPWARM = stripeEnv('STRIPE_PRICE_KEEPWARM')
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null

// The org's Stripe subscription id lives on organizations.stripe_subscription_id
// (added in 20260605_org_stripe_billing) and is read straight off the org row
// fetched below — no extra query, no bridging through the owner's users row.
// It's null until the checkout flow populates it, in which case the lifecycle
// actions stay status-only.

// Billable seats = owner + active reps (role manager|rep, excluding pending/
// rejected). Closers are not billed as seats. Keep this definition in sync with
// create-checkout-session.
async function countBillableSeats(adminClient: ReturnType<typeof createClient>, orgId: string): Promise<number> {
  const { count } = await adminClient
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .in('role', ['manager', 'rep'])
    .not('status', 'in', '("pending","rejected")')
  return Math.max(1, count || 1)
}

// Push the current seat count onto the org's Stripe subscription as the item
// quantity. No-op (never throws) when Stripe or a subscription isn't set up yet,
// so rep management keeps working before checkout exists.
async function syncSeatQuantity(
  adminClient: ReturnType<typeof createClient>,
  orgId: string,
  subscriptionId: string | null,
): Promise<string> {
  if (!stripe || !subscriptionId) return 'skipped: no subscription'
  try {
    const seats = await countBillableSeats(adminClient, orgId)
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    const item = sub.items.data[0]
    if (!item) return 'skipped: no item'
    if (item.quantity === seats) return `unchanged (${seats})`
    // always_invoice: bill the prorated difference immediately on seat change.
    // Makes annual seat-adds charge for the rest of the term right away (not a
    // year later); seat-removals become an account credit applied to future
    // invoices. No charge during the trial (Stripe won't invoice a trialing sub).
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, quantity: seats }],
      proration_behavior: 'always_invoice',
    })
    return `updated to ${seats}`
  } catch (e) {
    console.error('[manage-team] syncSeatQuantity error:', (e as Error).message)
    return `error: ${(e as Error).message}`
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the caller is an authenticated manager
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create a client with the service role key (has admin powers)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the JWT and check that the caller is a manager
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check role + org in public.users table
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('role, organization_id, is_super_admin, full_name')
      .eq('id', callerUser.id)
      .single()

    if (!callerProfile || callerProfile.role !== 'manager') {
      return new Response(JSON.stringify({ error: 'Forbidden: owner role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!callerProfile.organization_id) {
      return new Response(JSON.stringify({ error: 'Owner is not attached to an organization' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Pull the org up front — name for the invite email, plus owner_user_id
    // and status for the lifecycle actions (pause/cancel/delete), which are
    // owner-only and need the current state to validate transitions.
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('id, name, owner_user_id, status, trial_ends_at, purge_at, pause_prev_price_id, pause_prev_quantity, stripe_subscription_id')
      .eq('id', callerProfile.organization_id)
      .single()
    const orgName = orgRow?.name || 'your team'
    // The org owner is the only role allowed to pause/cancel/delete the
    // whole account. Super-admins can act on any org for support.
    const isOrgOwner = !!orgRow && orgRow.owner_user_id === callerUser.id
    const canManageLifecycle = isOrgOwner || !!callerProfile.is_super_admin

    const body = await req.json()
    const { action } = body

    // ── CREATE REP ───────────────────────────────────────────────────────────
    // Two modes, selected by the client via `mode`:
    //
    //   mode: 'invite' (default)
    //     Magic-link invite flow — Supabase generates a one-time action
    //     link and we email it via Resend. The rep clicks the link,
    //     lands on /set-password, and picks their own password. The
    //     manager never sees any credential. Requires a working Resend
    //     key + verified sending domain to be useful in production.
    //
    //   mode: 'temp_password'
    //     Manager-set credential flow — used when email isn't wired up
    //     yet. Caller passes a plaintext `password`; we create the auth
    //     user with `email_confirm: true` (skipping email verification
    //     entirely) and stamp `force_password_change = true` on
    //     public.users so the app forces the rep to pick a real
    //     password on first login. No email is sent; the manager is
    //     expected to deliver the credentials out-of-band (SMS, chat,
    //     in person). `phone` is also stored so the UI can offer a
    //     pre-filled SMS deep-link.
    //
    // Both modes persist `phone` when provided. `phone` is optional.
    if (action === 'create') {
      const { fullName, email, mode = 'invite', password, phone, role = 'rep' } = body
      if (!fullName || !email) {
        return new Response(JSON.stringify({ error: 'fullName and email are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (mode !== 'invite' && mode !== 'temp_password') {
        return new Response(JSON.stringify({ error: `Unknown mode "${mode}"` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Phase 2: role is now parameterized so the same flow handles reps
      // (door knockers / setters) and closers. 'manager' creation stays
      // out of this endpoint — owners self-sign-up. Default 'rep' keeps
      // older callers (the existing rep-add UI) working without changes.
      if (role !== 'rep' && role !== 'closer') {
        return new Response(JSON.stringify({ error: `Unknown role "${role}"` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Normalize phone — store null instead of empty string so the UI
      // can reliably detect "no phone on file". Leave formatting to the
      // client; we just strip surrounding whitespace.
      const phoneNormalized = typeof phone === 'string' && phone.trim() ? phone.trim() : null

      let newUserId: string
      let actionLink: string | null = null

      if (mode === 'invite') {
        // Generate the invite link. We do NOT call createUser first
        // because generateLink({ type: 'invite' }) creates the user itself —
        // double-creating would 422 on "User already registered".
        const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
          type: 'invite',
          email,
          options: {
            redirectTo: `${APP_BASE_URL}/set-password`,
            // Mirrored into auth.users.raw_user_meta_data so downstream
            // triggers (if any) and the /set-password screen can read it.
            data: { full_name: fullName, role },
          },
        })
        if (linkError || !linkData?.user || !linkData?.properties?.action_link) {
          return new Response(JSON.stringify({
            error: linkError?.message || 'Failed to generate invite link',
          }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        newUserId  = linkData.user.id
        actionLink = linkData.properties.action_link
      } else {
        // mode === 'temp_password'
        if (!password || typeof password !== 'string' || password.length < 8) {
          return new Response(JSON.stringify({
            error: 'password must be at least 8 characters for temp_password mode',
          }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        // `email_confirm: true` bypasses the email-verification step —
        // the rep can log in immediately with the password we were just
        // handed, which is the whole point of this mode. Without it,
        // Supabase would hold them in an unconfirmed state and require
        // an email round-trip we're explicitly trying to avoid.
        const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, role },
        })
        if (createError || !createData?.user) {
          return new Response(JSON.stringify({
            error: createError?.message || 'Failed to create rep account',
          }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        newUserId = createData.user.id
      }

      // public.users row. The auth schema has a `handle_new_user`
      // trigger that auto-creates this row when the auth user is spawned,
      // so we `upsert` to stamp org + role + full_name + phone (+ the
      // force-password-change flag for temp-password reps) on the
      // existing row. onConflict='id' makes this idempotent regardless
      // of whether the trigger ran.
      const { error: insertError } = await adminClient.from('users').upsert({
        id:                    newUserId,
        email,
        full_name:             fullName,
        role,
        organization_id:       callerProfile.organization_id,
        phone:                 phoneNormalized,
        force_password_change: mode === 'temp_password',
      }, { onConflict: 'id' })
      if (insertError) {
        console.warn('[manage-team] Could not insert public.users row:', insertError.message)
        // Roll back the auth user so a retry with the same email works.
        await adminClient.auth.admin.deleteUser(newUserId).catch(() => {})
        return new Response(JSON.stringify({
          error: `Could not attach rep to organization: ${insertError.message}`,
        }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Email delivery only runs for the magic-link path. Failures here
      // are reported to the caller (UI will show "created but email
      // failed — resend?") but don't roll back the user — the rep exists
      // and can be invited again from the team list.
      let emailResult: { ok: boolean; error?: string } = { ok: false }
      if (mode === 'invite' && actionLink) {
        emailResult = await sendInviteEmail({
          toEmail:     email,
          toName:      fullName,
          inviterName: callerProfile.full_name || 'Your manager',
          orgName,
          actionLink,
        })
      }

      // Seat count just changed — push the new quantity to Stripe (no-op until
      // the org has a subscription). Best-effort; never blocks rep creation.
      await syncSeatQuantity(adminClient, callerProfile.organization_id, orgRow?.stripe_subscription_id || null)

      return new Response(JSON.stringify({
        user: { id: newUserId, email, full_name: fullName, phone: phoneNormalized },
        mode,
        email_sent:   mode === 'invite' ? emailResult.ok            : false,
        email_error:  mode === 'invite' ? (emailResult.ok ? null : emailResult.error) : null,
        // Surface the login URL for the temp-password flow so the UI
        // can build a pre-filled SMS body ("Sign in at https://app…").
        // Intentionally omitted for invite mode — the action link goes
        // out via Resend and shouldn't be leaked back to the caller.
        login_url: mode === 'temp_password' ? `${APP_BASE_URL}/login` : null,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── DELETE REP ───────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { repId } = body
      if (!repId) {
        return new Response(JSON.stringify({ error: 'repId is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Make sure the rep actually belongs to this owner's organization.
      // Super-admins can delete across orgs.
      const { data: repProfile } = await adminClient
        .from('users')
        .select('organization_id, role')
        .eq('id', repId)
        .single()

      const sameOrg = repProfile?.organization_id === callerProfile.organization_id
      // Accept rep OR closer here — both are manage-team-managed team
      // members. Managers and owners can't be deleted through this path.
      const isTeamMember = repProfile?.role === 'rep' || repProfile?.role === 'closer'
      if (!repProfile || !isTeamMember || (!sameOrg && !callerProfile.is_super_admin)) {
        return new Response(JSON.stringify({ error: 'Team member not found or not under your organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Delete from public.users first (FK), then auth
      await adminClient.from('users').delete().eq('id', repId)
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(repId)
      if (deleteError) {
        return new Response(JSON.stringify({ error: deleteError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Seat count dropped — push the new quantity to Stripe (no-op pre-checkout).
      await syncSeatQuantity(adminClient, callerProfile.organization_id, orgRow?.stripe_subscription_id || null)

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── SYNC SEATS ─────────────────────────────────────────────────────────────
    // Recompute billable seats and push the quantity to the org's Stripe
    // subscription. Called by the client after team changes that don't go
    // through this function (invite-link approve / reject). Manager-allowed.
    if (action === 'sync_seats') {
      const result = await syncSeatQuantity(adminClient, callerProfile.organization_id, orgRow?.stripe_subscription_id || null)
      return new Response(JSON.stringify({ success: true, seats: result }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── RESEND INVITE ────────────────────────────────────────────────────────
    // Regenerates the invite link and re-sends the welcome email. Useful
    // when the original email got lost or the rep's inbox filtered it out.
    // Works on any existing rep in the caller's org — the invite link is
    // a fresh magic link, so sending it to an already-confirmed rep simply
    // logs them in.
    if (action === 'resend_invite') {
      const { repId } = body
      if (!repId) {
        return new Response(JSON.stringify({ error: 'repId is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: repProfile } = await adminClient
        .from('users')
        .select('email, full_name, organization_id, role')
        .eq('id', repId)
        .single()

      const sameOrg = repProfile?.organization_id === callerProfile.organization_id
      const isTeamMember = repProfile?.role === 'rep' || repProfile?.role === 'closer'
      if (!repProfile || !isTeamMember || (!sameOrg && !callerProfile.is_super_admin)) {
        return new Response(JSON.stringify({ error: 'Team member not found or not under your organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Use 'magiclink' so the link works whether or not the rep has
      // already confirmed their email. 'invite' errors on already-
      // registered users, which is most reps once they've been created.
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email: repProfile.email,
        options: { redirectTo: `${APP_BASE_URL}/set-password` },
      })
      if (linkError || !linkData?.properties?.action_link) {
        return new Response(JSON.stringify({
          error: linkError?.message || 'Failed to generate invite link',
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const emailResult = await sendInviteEmail({
        toEmail:     repProfile.email,
        toName:      repProfile.full_name || '',
        inviterName: callerProfile.full_name || 'Your manager',
        orgName,
        actionLink:  linkData.properties.action_link,
        isResend:    true,
      })

      return new Response(JSON.stringify({
        email_sent:  emailResult.ok,
        email_error: emailResult.ok ? null : emailResult.error,
        // Surfaced so a manager can copy/paste the invite link manually
        // if the email bounces (e.g. Resend still in test-domain mode or
        // the rep's inbox is eating the mail). The link is a single-use
        // magic link that the rep would have received anyway, so there
        // is no information leak beyond what the email contained.
        action_link: linkData.properties.action_link,
      }), {
        status: emailResult.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── ORG LIFECYCLE: PAUSE ───────────────────────────────────────────────
    // Seasonal owners stepping away for the off-season. Suspends billing to
    // the keep-warm fee and retains ALL data; the org auto-resumes on
    // resume_at (the access gate also treats "past resume_at" as active in
    // real time). Owner-only.
    if (action === 'pause_org') {
      if (!canManageLifecycle) {
        return new Response(JSON.stringify({ error: 'Forbidden: only the account owner can pause the organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { resumeAt, reason } = body
      // resumeAt is optional. If provided it must be a valid future date.
      let resumeIso: string | null = null
      if (resumeAt) {
        const d = new Date(resumeAt)
        if (isNaN(d.getTime())) {
          return new Response(JSON.stringify({ error: 'resumeAt is not a valid date' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        resumeIso = d.toISOString()
      }

      // ── Stripe: swap the subscription to the flat keep-warm price ──────────
      // We snapshot the org's current per-seat item (price + quantity) so
      // resume_org can restore it exactly, then move the subscription onto the
      // $5/mo keep-warm price at quantity 1. proration_behavior 'none' means we
      // don't credit/charge mid-cycle — the reduced rate just applies from the
      // next invoice. Any Stripe hiccup is non-fatal (logged + surfaced as a
      // warning) so the access change still happens; billing isn't fully live
      // yet, so we never want a Stripe gap to trap a paused team in the app.
      let prevPriceId: string | null = null
      let prevQuantity: number | null = null
      let billingWarning: string | null = null
      const subId = orgRow?.stripe_subscription_id || null
      if (stripe && STRIPE_PRICE_KEEPWARM && subId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId)
          const item = sub.items.data[0]
          prevPriceId  = item?.price?.id ?? null
          prevQuantity = item?.quantity ?? null
          if (item) {
            await stripe.subscriptions.update(subId, {
              items: [{ id: item.id, price: STRIPE_PRICE_KEEPWARM, quantity: 1 }],
              proration_behavior: 'none',
            })
          }
        } catch (e) {
          billingWarning = `Stripe pause failed: ${(e as Error).message}`
          console.error('[manage-team] pause_org stripe error:', billingWarning)
        }
      } else if (subId && (!stripe || !STRIPE_PRICE_KEEPWARM)) {
        billingWarning = 'Stripe keep-warm price not configured — billing not changed.'
      }

      const { data: updated, error: updErr } = await adminClient
        .from('organizations')
        .update({
          status:              'paused',
          paused_at:           new Date().toISOString(),
          resume_at:           resumeIso,
          lifecycle_reason:    reason || null,
          pause_prev_price_id: prevPriceId,
          pause_prev_quantity: prevQuantity,
        })
        .eq('id', callerProfile.organization_id)
        .select('id, status, paused_at, resume_at')
        .single()

      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await adminClient.from('org_lifecycle_events').insert({
        organization_id: callerProfile.organization_id,
        actor_user_id:   callerUser.id,
        event:           'paused',
        reason:          reason || null,
        metadata:        { resume_at: resumeIso, stripe_subscription: subId, prev_price: prevPriceId, prev_quantity: prevQuantity, billing_warning: billingWarning },
      })

      return new Response(JSON.stringify({ success: true, organization: updated, billing_warning: billingWarning }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── ORG LIFECYCLE: RESUME / REACTIVATE ─────────────────────────────────
    // Universal "bring the account back": un-pauses a paused org OR
    // reactivates a cancelled one that's still inside its 90-day grace
    // window. Flips to active and clears BOTH the pause and cancel dates so
    // the two flows can't leave stale state behind. Owner-only. (Refuses if
    // a cancelled org is already past purge_at — its data may be gone.)
    if (action === 'resume_org') {
      if (!canManageLifecycle) {
        return new Response(JSON.stringify({ error: 'Forbidden: only the account owner can reactivate the organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Block reactivating an org whose grace window has elapsed — at that
      // point the nightly purge may have already destroyed its data.
      if (orgRow?.status === 'cancelled' && orgRow?.purge_at && new Date(orgRow.purge_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: 'This account is past its 90-day grace window and can no longer be reactivated. Contact support.' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // ── Stripe: restore the per-seat plan we snapshotted at pause time ─────
      // If the org was paused onto the keep-warm price, swap the subscription
      // back to its original price + seat count. Non-fatal on error so a
      // Stripe blip can't strand the owner on the locked-out screen.
      let resumeBillingWarning: string | null = null
      const resumeSubId = orgRow?.stripe_subscription_id || null
      if (stripe && resumeSubId && orgRow?.pause_prev_price_id) {
        try {
          const sub = await stripe.subscriptions.retrieve(resumeSubId)
          const item = sub.items.data[0]
          if (item) {
            await stripe.subscriptions.update(resumeSubId, {
              items: [{ id: item.id, price: orgRow.pause_prev_price_id, quantity: orgRow.pause_prev_quantity || 1 }],
              proration_behavior: 'none',
            })
          }
        } catch (e) {
          resumeBillingWarning = `Stripe resume failed: ${(e as Error).message}`
          console.error('[manage-team] resume_org stripe error:', resumeBillingWarning)
        }
      }

      const { data: updated, error: updErr } = await adminClient
        .from('organizations')
        .update({
          status:              'active',
          paused_at:           null,
          resume_at:           null,
          cancelled_at:        null,
          purge_at:            null,
          pause_prev_price_id: null,
          pause_prev_quantity: null,
        })
        .eq('id', callerProfile.organization_id)
        .select('id, status')
        .single()

      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await adminClient.from('org_lifecycle_events').insert({
        organization_id: callerProfile.organization_id,
        actor_user_id:   callerUser.id,
        event:           'reactivated',
        reason:          'manual resume',
        metadata:        { stripe_subscription: resumeSubId, restored_price: orgRow?.pause_prev_price_id || null, billing_warning: resumeBillingWarning },
      })

      return new Response(JSON.stringify({ success: true, organization: updated, billing_warning: resumeBillingWarning }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── ORG LIFECYCLE: CANCEL ──────────────────────────────────────────────
    // Stops billing and soft-deletes the org. Data is retained for a 90-day
    // grace window (purge_at) so a seasonal owner can reactivate next season
    // before anything is destroyed. NOT a hard delete — see delete_org.
    // Owner-only.
    if (action === 'cancel_org') {
      if (!canManageLifecycle) {
        return new Response(JSON.stringify({ error: 'Forbidden: only the account owner can cancel the organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const { reason } = body
      const now = new Date()
      const purgeAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) // +90 days

      // ── Stripe: cancel at period end ───────────────────────────────────────
      // cancel_at_period_end lets the owner keep access through the rest of the
      // paid cycle and, more importantly, leaves the subscription resumable if
      // they reactivate inside the 90-day grace window (we just clear the flag
      // on resume). Non-fatal on error.
      let cancelBillingWarning: string | null = null
      const cancelSubId = orgRow?.stripe_subscription_id || null
      if (stripe && cancelSubId) {
        try {
          await stripe.subscriptions.update(cancelSubId, { cancel_at_period_end: true })
        } catch (e) {
          cancelBillingWarning = `Stripe cancel failed: ${(e as Error).message}`
          console.error('[manage-team] cancel_org stripe error:', cancelBillingWarning)
        }
      }

      const { data: updated, error: updErr } = await adminClient
        .from('organizations')
        .update({
          status:           'cancelled',
          cancelled_at:     now.toISOString(),
          purge_at:         purgeAt.toISOString(),
          lifecycle_reason: reason || null,
          // Clear any pending pause state so the two flows can't tangle.
          paused_at:        null,
          resume_at:        null,
        })
        .eq('id', callerProfile.organization_id)
        .select('id, status, cancelled_at, purge_at')
        .single()

      if (updErr) {
        return new Response(JSON.stringify({ error: updErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await adminClient.from('org_lifecycle_events').insert({
        organization_id: callerProfile.organization_id,
        actor_user_id:   callerUser.id,
        event:           'cancelled',
        reason:          reason || null,
        metadata:        { purge_at: purgeAt.toISOString(), stripe_subscription: cancelSubId, billing_warning: cancelBillingWarning },
      })

      return new Response(JSON.stringify({ success: true, organization: updated, billing_warning: cancelBillingWarning }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── ORG LIFECYCLE: HARD DELETE ─────────────────────────────────────────
    // Irreversible teardown: every member's auth user + the org row (and its
    // cascading public-schema data). Owner-only, and the client enforces a
    // typed confirmation before calling. This is the GDPR/"erase everything"
    // path, distinct from cancel (which keeps data for 90 days).
    if (action === 'delete_org') {
      if (!canManageLifecycle) {
        return new Response(JSON.stringify({ error: 'Forbidden: only the account owner can delete the organization' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Audit FIRST — the org_lifecycle_events FK cascades on org delete, so
      // we copy the org id into a plain log line before the row disappears.
      console.warn('[manage-team] HARD DELETE org', callerProfile.organization_id, 'by', callerUser.id)

      // Stripe: cancel the subscription immediately (no period-end grace — this
      // is the "erase everything now" path). Done before we delete the users
      // row that holds the subscription id. Non-fatal; teardown proceeds even
      // if Stripe errors so a billing blip can't leave the org half-deleted.
      const delSubId = orgRow?.stripe_subscription_id || null
      if (stripe && delSubId) {
        try {
          await stripe.subscriptions.cancel(delSubId)
        } catch (e) {
          console.error('[manage-team] delete_org stripe cancel error:', (e as Error).message)
        }
      }

      // Gather every member so we can delete their auth users. The owner is
      // included; we delete the caller's auth user last so the rest of the
      // teardown runs under a valid token.
      const { data: members } = await adminClient
        .from('users')
        .select('id')
        .eq('organization_id', callerProfile.organization_id)

      const memberIds: string[] = (members || []).map((m: { id: string }) => m.id)
      const others = memberIds.filter((id) => id !== callerUser.id)

      // 1. public.users rows (FK parents of most data) then the org row.
      //    Child tables referencing organization_id with ON DELETE CASCADE
      //    go with the org.
      await adminClient.from('users').delete().eq('organization_id', callerProfile.organization_id)
      const { error: orgDelErr } = await adminClient
        .from('organizations')
        .delete()
        .eq('id', callerProfile.organization_id)
      if (orgDelErr) {
        return new Response(JSON.stringify({ error: orgDelErr.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // 2. auth.users — members first, then the owner/caller last.
      for (const id of others) {
        const { error } = await adminClient.auth.admin.deleteUser(id)
        if (error) console.warn('[manage-team] delete_org: auth delete failed for', id, error.message)
      }
      // Caller last (super-admins acting on another org won't be a member,
      // so this is a no-op miss for them, which is fine).
      if (memberIds.includes(callerUser.id)) {
        const { error } = await adminClient.auth.admin.deleteUser(callerUser.id)
        if (error) console.warn('[manage-team] delete_org: auth delete failed for owner', error.message)
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[manage-team] Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ── Invite / welcome email ──────────────────────────────────────────────────
// The Resend transport + HTML escaping now live in ../_shared/email.ts so
// every KnockIQ email shares one sender path. This function keeps the
// invite-specific *body* (richer than the generic shared layout — it carries
// a "What is KnockIQ?" explainer and the one-time-link block) and hands the
// finished HTML/text to the shared sendEmail.
//
// Returns { ok: boolean, error?: string } so the caller can surface send
// failures to the manager without rolling back the rep creation.
async function sendInviteEmail({
  toEmail,
  toName,
  inviterName,
  orgName,
  actionLink,
  isResend = false,
}: {
  toEmail:     string
  toName:      string
  inviterName: string
  orgName:     string
  actionLink:  string
  isResend?:   boolean
}): Promise<{ ok: boolean; error?: string }> {
  const subject = isResend
    ? `Your KnockIQ invite (resent) — finish setting up your account`
    : `${inviterName} invited you to KnockIQ`

  const html = buildInviteHtml({ toName, inviterName, orgName, actionLink, isResend })
  const text = buildInviteText({ toName, inviterName, orgName, actionLink, isResend })

  const { ok, error } = await sendEmail({ to: toEmail, subject, html, text })
  return { ok, error }
}

// HTML email body. Kept inline (no template engine) so the edge function
// doesn't depend on a template file at deploy time. Minimal, branded,
// single CTA — designed to render well on mobile Mail / Gmail / Outlook.
function buildInviteHtml(args: {
  toName:      string
  inviterName: string
  orgName:     string
  actionLink:  string
  isResend:    boolean
}): string {
  const { toName, inviterName, orgName, actionLink, isResend } = args
  const greeting = toName ? `Hey ${escapeHtml(toName.split(' ')[0])},` : 'Hey there,'
  const intro = isResend
    ? `Here's a fresh invite link for KnockIQ. The previous one may have expired — this one is good for the next 24 hours.`
    : `${escapeHtml(inviterName)} just added you to <strong>${escapeHtml(orgName)}</strong> on KnockIQ. KnockIQ is the canvassing app we use to track knocks, log interactions, and keep the leaderboard honest.`

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome to KnockIQ</title>
  </head>
  <body style="margin:0; padding:0; background-color:#F3F4F6; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#1F2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; background-color:#FFFFFF; border-radius:16px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td style="background-color:#1B4FCC; padding:26px 32px;">
                <img src="https://www.getknockiq.com/logo-white.png" alt="KnockIQ" height="32" style="height:32px; width:auto; display:block; border:0; outline:none; text-decoration:none;" />
                <div style="color:#DBEAFE; font-size:13px; margin-top:10px;">You're invited to the team</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 16px 0; font-size:16px; line-height:1.55;">${greeting}</p>
                <p style="margin:0 0 20px 0; font-size:15px; line-height:1.6; color:#374151;">${intro}</p>
                <p style="margin:0 0 24px 0; font-size:15px; line-height:1.6; color:#374151;">
                  Click the button below to set your password and log in. The link is one-time use and will expire in 24&nbsp;hours.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:12px; background-color:#1B4FCC;">
                      <a href="${escapeAttr(actionLink)}"
                         style="display:inline-block; padding:14px 28px; font-size:15px; font-weight:700; color:#FFFFFF; text-decoration:none; border-radius:12px;">
                        Set Up My Account →
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 8px 0; font-size:13px; color:#6B7280;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 0 0; font-size:12px; color:#6B7280; word-break:break-all;">
                  <a href="${escapeAttr(actionLink)}" style="color:#1B4FCC; text-decoration:underline;">${escapeHtml(actionLink)}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px 32px; border-top:1px solid #E5E7EB;">
                <p style="margin:0 0 8px 0; font-size:13px; color:#6B7280; line-height:1.55;">
                  <strong style="color:#374151;">What is KnockIQ?</strong> A canvassing companion that auto-detects door knocks via GPS, helps you log outcomes in one tap, and shows where your teammates have recently been so you don't re-hit the same block.
                </p>
                <p style="margin:8px 0 0 0; font-size:12px; color:#9CA3AF; line-height:1.55;">
                  If you weren't expecting this email, you can ignore it — the invite will expire on its own.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0; font-size:11px; color:#9CA3AF;">
            Sent to ${escapeHtml(toName || '')} at the request of ${escapeHtml(inviterName)}.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

// Plain-text fallback for clients that can't / won't render HTML. Every
// well-behaved email provider expects both a `text` and `html` body —
// omitting the text part noticeably hurts spam scoring.
function buildInviteText(args: {
  toName:      string
  inviterName: string
  orgName:     string
  actionLink:  string
  isResend:    boolean
}): string {
  const { toName, inviterName, orgName, actionLink, isResend } = args
  const greeting = toName ? `Hey ${toName.split(' ')[0]},` : 'Hey there,'
  const intro = isResend
    ? `Here's a fresh invite link for KnockIQ. The previous one may have expired — this one is good for the next 24 hours.`
    : `${inviterName} just added you to ${orgName} on KnockIQ, our canvassing app.`
  return `${greeting}

${intro}

Set your password and log in here (link expires in 24 hours):
${actionLink}

If you weren't expecting this email, you can ignore it — the invite will expire on its own.

— The KnockIQ team`
}

// escapeHtml / escapeAttr are imported from ../_shared/email.ts (the inviter's
// name, org name, and rep's first name come from DB rows and must be escaped
// before landing in the HTML body).
