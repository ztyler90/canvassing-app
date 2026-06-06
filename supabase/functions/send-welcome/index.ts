/**
 * send-welcome · onboarding email for a freshly-provisioned owner/org
 * ----------------------------------------------------------------------------
 * Fired by the client right after `provision_new_organization` succeeds in
 * the Signup flow (see lib/supabase.js → sendWelcomeEmail). We deliberately
 * send this from an edge function rather than a DB trigger so we can:
 *   • use the service-role key to read the owner + org rows past RLS,
 *   • run the branded Resend template that lives in _shared/email.ts, and
 *   • return a delivery result the Signup screen can log (best-effort — a
 *     missed welcome email must never block account creation).
 *
 * Auth model: the platform JWT pre-verifier is ON (a valid signed-in token is
 * required), and we ALSO authenticate the caller ourselves with
 * adminClient.auth.getUser(token). The email always goes to the *caller's own*
 * address — there's no caller-supplied recipient, so this can't be used to
 * spam arbitrary people.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail, brandedEmail, brandedText, firstNameGreeting } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://app.knockiq.com').replace(/\/$/, '')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401)
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(token)
    if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

    // Read the caller's profile + org. The owner just provisioned the org,
    // so both rows exist by the time the client calls us.
    const { data: profile, error: profErr } = await adminClient
      .from('users')
      .select('id, full_name, email, role, organization_id')
      .eq('id', caller.id)
      .single()
    if (profErr || !profile) return json({ error: 'Profile not found' }, 404)

    const toEmail = profile.email || caller.email
    if (!toEmail) return json({ error: 'No email on file for caller' }, 400)

    let orgName = 'your team'
    if (profile.organization_id) {
      const { data: org } = await adminClient
        .from('organizations')
        .select('name')
        .eq('id', profile.organization_id)
        .single()
      if (org?.name) orgName = org.name
    }

    const greeting = firstNameGreeting(profile.full_name)
    const opts = {
      eyebrow:  'Welcome aboard',
      greeting,
      intro: [
        `${orgName} is set up and ready to go. KnockIQ is your command center for door-to-door — track knocks, log interactions, route hot leads to closers, and keep the leaderboard honest.`,
        'A few things worth doing first:',
        '1. Add your reps in Settings → Team (email invite or temp password).',
        '2. Add your closers so hot leads route straight to them.',
        '3. Draw your territories on the map so reps know where to knock.',
      ],
      cta:      { label: 'Open KnockIQ →', url: `${APP_BASE_URL}/` },
      footnote: 'Questions? Just reply to this email — it reaches a human on our team.',
    }

    const result = await sendEmail({
      to:      toEmail,
      subject: `Welcome to KnockIQ, ${orgName} is ready`,
      html:    brandedEmail(opts),
      text:    brandedText(opts),
    })

    return json({ sent: result.ok, email_error: result.ok ? null : result.error }, 200)
  } catch (err) {
    console.error('[send-welcome] Unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
