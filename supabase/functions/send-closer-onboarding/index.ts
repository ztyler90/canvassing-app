/**
 * send-closer-onboarding · welcome email when a closer is added
 * ----------------------------------------------------------------------------
 * A closer in KnockIQ comes in two tiers (see migration 20260603_closer_contacts):
 *   • contact  — email-only, no platform login. Just receives lead emails.
 *   • platform — role='closer' user with Closer Inbox access.
 *
 * When a manager adds either kind, this function sends a branded "you've been
 * set up as a closer" email so the person knows what to expect *before* the
 * first lead lands in their inbox. The body branches on tier: platform closers
 * get a CTA into their Closer Inbox; email-only contacts get an explainer that
 * leads will simply arrive by email (no login to chase).
 *
 * Auth model: the platform JWT pre-verifier is ON, and we ALSO authenticate
 * the caller with adminClient.auth.getUser(token) and enforce that the caller
 * is a manager (or super-admin) in the SAME org as the closer — no cross-tenant
 * onboarding, no rep spamming arbitrary addresses.
 *
 * Request body (exactly one id):
 *   { closerContactId: "<uuid>" }   → email-only contact
 *   { closerUserId:    "<uuid>" }   → platform closer (public.users row)
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
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await adminClient.auth.getUser(token)
    if (authErr || !caller) return json({ error: 'Invalid token' }, 401)

    const { closerContactId, closerUserId } = await req.json().catch(() => ({}))
    if (!closerContactId && !closerUserId) {
      return json({ error: 'closerContactId or closerUserId is required' }, 400)
    }
    if (closerContactId && closerUserId) {
      return json({ error: 'Pass only one of closerContactId / closerUserId' }, 400)
    }

    // Caller must be a manager (the app's owner/admin role) or a super-admin.
    // Reps don't add closers. Mirrors manage-team's guard: role is one of
    // 'rep' | 'manager', and super-admin is the separate is_super_admin flag.
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('organization_id, role, is_super_admin')
      .eq('id', caller.id)
      .single()
    if (!callerProfile?.organization_id) {
      return json({ error: 'Caller has no organization' }, 403)
    }
    if (callerProfile.role !== 'manager' && !callerProfile.is_super_admin) {
      return json({ error: 'Forbidden: manager role required' }, 403)
    }

    // Resolve the closer's name/email/org + tier.
    let closer: { full_name: string; email: string; org_id: string } | null = null
    let tier: 'platform' | 'contact'

    if (closerUserId) {
      tier = 'platform'
      const { data: u } = await adminClient
        .from('users')
        .select('full_name, email, organization_id, role')
        .eq('id', closerUserId)
        .single()
      if (!u) return json({ error: 'Closer user not found' }, 404)
      closer = { full_name: u.full_name || '', email: u.email || '', org_id: u.organization_id }
    } else {
      tier = 'contact'
      const { data: c } = await adminClient
        .from('closer_contacts')
        .select('full_name, email, organization_id')
        .eq('id', closerContactId)
        .single()
      if (!c) return json({ error: 'Closer contact not found' }, 404)
      closer = { full_name: c.full_name || '', email: c.email || '', org_id: c.organization_id }
    }

    // Same-org guard.
    if (closer.org_id !== callerProfile.organization_id) {
      return json({ error: 'Cross-org onboarding denied' }, 403)
    }
    if (!closer.email) return json({ error: 'Closer has no email on file' }, 400)

    // Org name for the copy.
    let orgName = 'your team'
    const { data: org } = await adminClient
      .from('organizations')
      .select('name')
      .eq('id', closer.org_id)
      .single()
    if (org?.name) orgName = org.name

    const greeting = firstNameGreeting(closer.full_name)
    const opts = tier === 'platform'
      ? {
          eyebrow:  'You\'re a closer',
          logoUrl:  `${APP_BASE_URL}/logo-white.png`,
          greeting,
          intro: [
            `You've been set up as a closer for ${orgName} on KnockIQ. When a setter hands off a hot lead to you, it'll show up in your Closer Inbox and we'll email you the details right away.`,
            'Sign in to see your assigned leads, appointment times, and customer notes all in one place. You can pick how you want to be notified — app, email, or both — from your settings.',
          ],
          cta:      { label: 'Open your Closer Inbox →', url: `${APP_BASE_URL}/closer` },
          footnote: 'Questions? Just reply to this email — it reaches a human on our team.',
        }
      : {
          eyebrow:  'You\'re a closer',
          logoUrl:  `${APP_BASE_URL}/logo-white.png`,
          greeting,
          intro: [
            `You've been added as a closer for ${orgName} on KnockIQ — the door-to-door app the team uses to capture leads in the field.`,
            'There\'s nothing to set up on your end. Each time a setter assigns you a hot lead, you\'ll get an email with the customer\'s name, address, phone, the service they\'re interested in, the appointment time, and any notes — everything you need to close.',
            'Keep an eye on your inbox; the first lead could land any time.',
          ],
          footnote: 'Questions? Just reply to this email — it reaches a human on the team.',
        }

    const result = await sendEmail({
      to:      closer.email,
      subject: `You're set up as a closer for ${orgName}`,
      html:    brandedEmail(opts),
      text:    brandedText(opts),
    })

    return json({ sent: result.ok, tier, email_error: result.ok ? null : result.error }, 200)
  } catch (err) {
    console.error('[send-closer-onboarding] Unhandled error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
