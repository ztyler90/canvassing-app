/**
 * notify-closer · Phase 3 lead-assignment notification dispatcher
 *
 * Called from the client immediately after a Hot Lead is inserted with
 * a `closer_id`. Looks up the closer's `closer_notification_pref` and
 * dispatches:
 *
 *   'email' → Resend email (transactional, same provider as the invite flow)
 *   'sms'   → currently logged-only (no Twilio yet — falls back to email if
 *             we have an email on file, otherwise no-op with a warning)
 *   'app'   → no-op; the closer sees the lead on next inbox refresh
 *   'both'  → email + sms (sms falls back per above)
 *
 * Why not a database trigger?
 *   Postgres triggers can't make outbound HTTP calls cleanly. Supabase has
 *   `pg_net` for this but it's async-fire-and-forget without delivery
 *   feedback. Calling the function from the client lets us surface
 *   delivery failures to the rep ("created but couldn't notify Mike —
 *   please ping him directly") while keeping the email logic in one
 *   reusable place.
 *
 * Auth model:
 *   verify_jwt=true. The caller (a rep) must be signed in. The function
 *   verifies the rep belongs to the same org as the closer being notified
 *   — no cross-org pings.
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: callerUser }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { interactionId } = await req.json()
    if (!interactionId) {
      return new Response(JSON.stringify({ error: 'interactionId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Pull the lead + closer + setter rows in one round trip. We need the
    // lead's customer fields for the email body, the closer's email/phone/
    // pref for routing, and the setter's name to identify who's handing
    // the lead off ("From Mike R.").
    const { data: lead, error: leadErr } = await adminClient
      .from('interactions')
      .select(`
        id, organization_id, address, contact_name, contact_phone,
        contact_email, service_types, estimated_value, service_line_items, notes,
        appointment_at, closer_id, closer_contact_id, rep_id,
        closer:closer_id                 ( id, email, full_name, phone, closer_notification_pref ),
        closer_contact:closer_contact_id ( id, email, full_name, phone, notification_pref ),
        setter:rep_id                    ( id, full_name )
      `)
      .eq('id', interactionId)
      .single()

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!lead.closer_id && !lead.closer_contact_id) {
      // Nothing to do — the lead isn't assigned. Quietly succeed so the
      // client can call this defensively after every insert without
      // branching on whether routing was setter_picks / round_robin /
      // manager_assigns.
      return new Response(JSON.stringify({ delivered: false, reason: 'unassigned' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Same-org guard. The caller (setter) and closer must belong to the
    // same org. Prevents a malicious rep from spamming closers in a
    // different tenant.
    const { data: callerProfile } = await adminClient
      .from('users')
      .select('organization_id')
      .eq('id', callerUser.id)
      .single()
    if (!callerProfile || callerProfile.organization_id !== lead.organization_id) {
      return new Response(JSON.stringify({ error: 'Cross-org notification denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Phase 5: closer can be a platform user (closer_id) OR an email-only
    // contact (closer_contact_id). Read whichever join is populated and
    // normalize the field names so the rest of this function doesn't care.
    const platformCloser = (lead as any).closer
    const contactCloser  = (lead as any).closer_contact
    const setter         = (lead as any).setter
    const closer = platformCloser
      ? {
          tier:    'platform' as const,
          id:      platformCloser.id,
          email:   platformCloser.email,
          full_name: platformCloser.full_name,
          phone:   platformCloser.phone,
          pref:    platformCloser.closer_notification_pref || 'email',
        }
      : contactCloser
        ? {
            tier:    'contact' as const,
            id:      contactCloser.id,
            email:   contactCloser.email,
            full_name: contactCloser.full_name,
            phone:   contactCloser.phone,
            // Email-only contacts can't pick 'app' — schema CHECK enforces.
            pref:    contactCloser.notification_pref || 'email',
          }
        : null
    if (!closer) {
      return new Response(JSON.stringify({ error: 'Closer profile missing' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const pref = closer.pref

    // 'app' = no outbound notification at all. Only meaningful for
    // platform users — email-only contacts can't pick this (schema
    // CHECK), but defensively treat as no-op anyway. The closer checks
    // the inbox on their own cadence.
    if (pref === 'app') {
      return new Response(JSON.stringify({ delivered: true, channel: 'app' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build the lead summary once — reused for email + (future) SMS.
    // Platform users get a CTA back into their Closer Inbox; email-only
    // contacts don't (no login). The email template branches on whether
    // inboxUrl is non-empty.
    const setterName = setter?.full_name || 'A setter'
    const summary = {
      customerName: lead.contact_name || 'New lead',
      address:      lead.address      || '',
      phone:        lead.contact_phone || '',
      services:     Array.isArray(lead.service_types) ? lead.service_types.join(', ') : '',
      value:        lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '',
      lineItems:    formatLineItems(lead.service_line_items),
      appointment:  lead.appointment_at ? formatAppt(lead.appointment_at) : '',
      notes:        lead.notes || '',
      setterName,
      // Deep-link straight to this lead in the Closer Inbox. CloserHome reads
      // ?lead to scroll the matching card into view and highlight it (the
      // inbox is a flat card list, not a modal). Email-only contacts have no
      // login, so they get no CTA at all (empty string).
      inboxUrl:     closer.tier === 'platform' ? `${APP_BASE_URL}/closer?lead=${interactionId}` : '',
    }

    const channels: string[] = []
    let emailResult:  { ok: boolean; error?: string } | null = null
    let smsResult:    { ok: boolean; error?: string } | null = null

    if (pref === 'email' || pref === 'both') {
      if (!closer.email) {
        emailResult = { ok: false, error: 'closer has no email on file' }
      } else {
        emailResult = await sendLeadEmail({
          toEmail:   closer.email,
          toName:    closer.full_name || '',
          summary,
        })
        if (emailResult.ok) channels.push('email')
      }
    }

    if (pref === 'sms' || pref === 'both') {
      // SMS provider (Twilio) isn't wired up yet. Log a warning so we
      // know who tried to use this in the field, and fall back to email
      // if we have one — better something than nothing.
      console.warn('[notify-closer] SMS pref not yet implemented for closer', closer.id)
      smsResult = { ok: false, error: 'SMS provider not configured' }
      if (pref === 'sms' && closer.email && !emailResult) {
        emailResult = await sendLeadEmail({
          toEmail: closer.email,
          toName:  closer.full_name || '',
          summary,
        })
        if (emailResult.ok) channels.push('email-fallback')
      }
    }

    return new Response(JSON.stringify({
      delivered:    channels.length > 0,
      channels,
      email_error:  emailResult?.ok === false ? emailResult.error : null,
      sms_error:    smsResult?.ok   === false ? smsResult.error   : null,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[notify-closer] Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// Format an ISO timestamp as a human-readable line for the email.
// Keeps the timezone agnostic (UTC display with offset) so a closer
// reading the email on the road isn't misled by server-side localization.
function formatAppt(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short', month: 'short', day: 'numeric',
      hour:    'numeric', minute: '2-digit',
    }
    return d.toLocaleString('en-US', opts)
  } catch {
    return iso
  }
}

interface LeadSummary {
  customerName: string
  address:      string
  phone:        string
  services:     string
  value:        string
  lineItems:    string
  appointment:  string
  notes:        string
  setterName:   string
  inboxUrl:     string
}

// Render the itemized estimate (if the rep priced each service at the door)
// as a single readable line for the email body, e.g.
//   "Window Cleaning: $250 · Gutter Guards: $900". Empty when not itemized.
function formatLineItems(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items
    .map((li) => {
      const svc   = li?.service ?? ''
      const price = Number(li?.price || 0)
      return `${svc}: $${price.toLocaleString()}`
    })
    .join(' · ')
}

async function sendLeadEmail({
  toEmail, toName, summary,
}: {
  toEmail: string
  toName:  string
  summary: LeadSummary
}): Promise<{ ok: boolean; error?: string }> {
  const subject = summary.appointment
    ? `New lead · ${summary.customerName} · ${summary.appointment}`
    : `New lead · ${summary.customerName}`

  // Builds on the shared branded layout so the lead email matches the
  // welcome / closer-onboarding / invite emails. brandedEmail handles all
  // HTML escaping, so we pass raw values here.
  const opts = {
    eyebrow:  `From ${summary.setterName}`,
    heading:  'New Lead',
    greeting: firstNameGreeting(toName),
    intro:    ["You've been assigned a new lead. Details below."],
    rows: [
      { label: 'Customer',    value: summary.customerName },
      { label: 'Address',     value: summary.address },
      { label: 'Phone',       value: summary.phone },
      { label: 'Service',     value: summary.services },
      { label: 'Est. value',  value: summary.value },
      { label: 'Itemized',    value: summary.lineItems },
      { label: 'Appointment', value: summary.appointment },
      { label: 'Notes',       value: summary.notes },
    ],
    ...(summary.inboxUrl ? { cta: { label: 'Open in KnockIQ →', url: summary.inboxUrl } } : {}),
  }

  return await sendEmail({
    to:      toEmail,
    subject,
    html:    brandedEmail(opts),
    text:    brandedText(opts),
  })
}
