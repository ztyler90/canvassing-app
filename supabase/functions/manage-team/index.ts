import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Runtime config ──────────────────────────────────────────────────────────
// RESEND_API_KEY / RESEND_FROM: credentials for the transactional email
// provider. Falls back to logging if RESEND_API_KEY is unset so local
// development can exercise the create-rep flow without a real key.
// APP_BASE_URL: used as the `redirectTo` target on the invite link — the
// rep lands on this URL after clicking the email link, which routes them
// to the /set-password screen where they pick their password.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM    = Deno.env.get('RESEND_FROM')    || 'KnockIQ <onboarding@resend.dev>'
const APP_BASE_URL   = (Deno.env.get('APP_BASE_URL')  || 'https://app.knockiq.com').replace(/\/$/, '')

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

    // Pull the org name up front — we only need it for the invite email,
    // so skip if the organizations table lookup fails.
    const { data: orgRow } = await adminClient
      .from('organizations')
      .select('name')
      .eq('id', callerProfile.organization_id)
      .single()
    const orgName = orgRow?.name || 'your team'

    const body = await req.json()
    const { action } = body

    // ── CREATE REP (invite-link flow) ────────────────────────────────────────
    // Flow:
    //   1. Validate payload
    //   2. `admin.generateLink({ type: 'invite', ... })` — creates the auth
    //      user as invited (unconfirmed, no password) AND returns a one-time
    //      action link pointing at our /set-password route.
    //   3. Insert a public.users row stamped with the caller's org so
    //      RLS + seat-count aggregation work immediately.
    //   4. POST the welcome email to Resend with the action link embedded.
    //      We don't block on failure — the rep is already created, and the
    //      manager can resend the invite (coming soon) if the email didn't
    //      make it through. We DO surface the failure in the response so
    //      the UI can show a toast.
    if (action === 'create') {
      const { fullName, email } = body
      if (!fullName || !email) {
        return new Response(JSON.stringify({ error: 'fullName and email are required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Step 1/2: Generate the invite link. We do NOT call createUser first
      // because generateLink({ type: 'invite' }) creates the user itself —
      // double-creating would 422 on "User already registered".
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: 'invite',
        email,
        options: {
          redirectTo: `${APP_BASE_URL}/set-password`,
          // Mirrored into auth.users.raw_user_meta_data so downstream
          // triggers (if any) and the /set-password screen can read it.
          data: { full_name: fullName, role: 'rep' },
        },
      })
      if (linkError || !linkData?.user || !linkData?.properties?.action_link) {
        return new Response(JSON.stringify({
          error: linkError?.message || 'Failed to generate invite link',
        }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const newUser    = linkData.user
      const actionLink = linkData.properties.action_link

      // Step 3: public.users row. The auth schema has a `handle_new_user`
      // trigger that auto-creates this row when generateLink() spawns the
      // auth user, so we `upsert` to stamp org + role + full_name on the
      // existing row. onConflict='id' makes this idempotent regardless of
      // whether the trigger ran.
      const { error: insertError } = await adminClient.from('users').upsert({
        id:              newUser.id,
        email,
        full_name:       fullName,
        role:            'rep',
        organization_id: callerProfile.organization_id,
      }, { onConflict: 'id' })
      if (insertError) {
        console.warn('[manage-team] Could not insert public.users row:', insertError.message)
        // Roll back the auth user so a retry with the same email works.
        await adminClient.auth.admin.deleteUser(newUser.id).catch(() => {})
        return new Response(JSON.stringify({
          error: `Could not attach rep to organization: ${insertError.message}`,
        }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Step 4: Welcome email via Resend. Failures here are reported to
      // the caller (UI will show "created but email failed — resend?")
      // but don't roll back the user — the rep exists and can be invited
      // again from the team list.
      const emailResult = await sendInviteEmail({
        toEmail:     email,
        toName:      fullName,
        inviterName: callerProfile.full_name || 'Your manager',
        orgName,
        actionLink,
      })

      return new Response(JSON.stringify({
        user: { id: newUser.id, email, full_name: fullName },
        email_sent:   emailResult.ok,
        email_error:  emailResult.ok ? null : emailResult.error,
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
      if (!repProfile || repProfile.role !== 'rep' || (!sameOrg && !callerProfile.is_super_admin)) {
        return new Response(JSON.stringify({ error: 'Rep not found or not under your organization' }), {
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

      return new Response(JSON.stringify({ success: true }), {
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
      if (!repProfile || repProfile.role !== 'rep' || (!sameOrg && !callerProfile.is_super_admin)) {
        return new Response(JSON.stringify({ error: 'Rep not found or not under your organization' }), {
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
      }), {
        status: emailResult.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

// ── Resend integration ──────────────────────────────────────────────────────
// Sends the welcome / invite email via Resend's REST API
// (https://api.resend.com/emails). We use fetch + JSON rather than pulling
// in an SDK so the edge function's bundle stays small and cold-start fast.
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
  if (!RESEND_API_KEY) {
    // Local dev convenience: log the link instead of failing the action.
    // Deployed functions must set RESEND_API_KEY — the caller will see
    // email_sent=false if the env var is missing in production.
    console.warn('[manage-team] RESEND_API_KEY not set — skipping email send.')
    console.warn('[manage-team] Would have sent invite link to', toEmail, actionLink)
    return { ok: false, error: 'RESEND_API_KEY not configured' }
  }

  const subject = isResend
    ? `Your KnockIQ invite (resent) — finish setting up your account`
    : `${inviterName} invited you to KnockIQ`

  const html = buildInviteHtml({ toName, inviterName, orgName, actionLink, isResend })
  const text = buildInviteText({ toName, inviterName, orgName, actionLink, isResend })

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    RESEND_FROM,
        to:      [toEmail],
        subject,
        html,
        text,
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[manage-team] Resend send failed', res.status, errText)
      return { ok: false, error: `Resend error ${res.status}: ${errText.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[manage-team] Resend fetch threw:', msg)
    return { ok: false, error: msg }
  }
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
              <td style="background-color:#1B4FCC; padding:28px 32px;">
                <div style="color:#FFFFFF; font-weight:700; font-size:20px; letter-spacing:-0.01em;">KnockIQ</div>
                <div style="color:#DBEAFE; font-size:13px; margin-top:4px;">You're invited to the team</div>
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

// Tiny HTML escaper — the inviter's name, org name, and rep's first name
// all come from DB rows and shouldn't land in HTML raw. Good enough for
// template-style interpolation; not a general-purpose sanitizer.
function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s)
}
