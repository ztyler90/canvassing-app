/**
 * send-growth-welcome · onboarding email for a newly provisioned growth rep
 * ----------------------------------------------------------------------------
 * The Growth Commissions portal (getknockiq.com/growth) lets a super-admin add
 * a growth partner via the `growth_provision_manager` RPC, which creates a
 * confirmed auth login + a public.growth_managers row. Historically the admin
 * then shared a temp password by hand. This function closes that loop: it
 * emails the new rep a branded welcome with a one-time "Set your password"
 * link, so they pick their own credential and land in the Growth dashboard.
 *
 * Called from public/growth.html right after growth_provision_manager succeeds.
 *
 * Auth model: the platform JWT pre-verifier is ON, AND we re-authenticate the
 * caller here and require they're a super-admin (mirrors the RPC's own
 * `is_current_user_super_admin()` gate — auth_is_super_admin() reads
 * public.users.is_super_admin). The recipient must already exist in
 * public.growth_managers, so this can't be used to email arbitrary addresses.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail, brandedEmail, brandedText, firstNameGreeting } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Where the set-password link sends the rep. The Growth portal lives on the
// marketing origin, NOT app.knockiq.com — so this is its own env, defaulting
// to the production URL. Must be in Supabase Auth → URL Configuration →
// Redirect URLs for GoTrue to honor the recovery redirect.
const GROWTH_PORTAL_URL = (Deno.env.get('GROWTH_PORTAL_URL') || 'https://www.getknockiq.com/growth').replace(/\/$/, '')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(token)
    if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

    // Super-admin only — matches growth_provision_manager's gate.
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('is_super_admin')
      .eq('id', caller.id)
      .single()
    if (!callerProfile?.is_super_admin) {
      return json({ error: 'Forbidden: super-admin required' }, 403)
    }

    const { email } = await req.json().catch(() => ({}))
    if (!email || typeof email !== 'string') {
      return json({ error: 'email is required' }, 400)
    }
    const lowerEmail = email.trim().toLowerCase()

    // The recipient must be a real, existing growth rep — never an arbitrary
    // address. growth_provision_manager just inserted this row.
    const { data: gm } = await adminClient
      .from('growth_managers')
      .select('full_name, email, referral_code')
      .eq('email', lowerEmail)
      .single()
    if (!gm) return json({ error: 'No growth_managers row for that email' }, 404)

    // Generate a one-time "set your password" (recovery) link. The rep lands
    // on the Growth portal with a recovery session and sets their password.
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type:  'recovery',
      email: lowerEmail,
      options: { redirectTo: GROWTH_PORTAL_URL },
    })
    if (linkErr || !linkData?.properties?.action_link) {
      return json({ error: linkErr?.message || 'Failed to generate set-password link' }, 502)
    }
    const actionLink = linkData.properties.action_link

    const greeting = firstNameGreeting(gm.full_name)
    const opts = {
      eyebrow:  'KnockIQ Growth',
      greeting,
      intro: [
        "You've been set up as a growth partner for KnockIQ — welcome aboard!",
        'Tap the button below to set your password. You\'ll then land in your Growth dashboard, where you can track the accounts you\'ve referred and the commissions they earn.',
      ],
      rows: gm.referral_code ? [{ label: 'Your referral code', value: gm.referral_code }] : undefined,
      cta:      { label: 'Set your password →', url: actionLink },
      footnote: `This link expires in 1 hour. After that, your KnockIQ contact can resend it. Your portal lives at ${GROWTH_PORTAL_URL}.`,
    }

    const result = await sendEmail({
      to:      lowerEmail,
      subject: 'Welcome to KnockIQ Growth — set your password',
      html:    brandedEmail(opts),
      text:    brandedText(opts),
    })

    return json({ sent: result.ok, email_error: result.ok ? null : result.error }, 200)
  } catch (err) {
    console.error('[send-growth-welcome] Unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
