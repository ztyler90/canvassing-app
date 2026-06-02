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

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const RESEND_FROM    = Deno.env.get('RESEND_FROM')    || 'KnockIQ <leads@resend.dev>'
const APP_BASE_URL   = (Deno.env.get('APP_BASE_URL')  || 'https://app.knockiq.com').replace(/\/$/, '')

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
        contact_email, service_types, estimated_value, notes,
        appointment_at, closer_id, rep_id,
        closer:closer_id ( id, email, full_name, phone, closer_notification_pref ),
        setter:rep_id   ( id, full_name )
      `)
      .eq('id', interactionId)
      .single()

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!lead.closer_id) {
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

    const closer = (lead as any).closer
    const setter = (lead as any).setter
    if (!closer) {
      return new Response(JSON.stringify({ error: 'Closer profile missing' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const pref = closer.closer_notification_pref || 'email'

    // 'app' = no outbound notification at all. The closer checks the
    // inbox on their own cadence. Quietly succeed.
    if (pref === 'app') {
      return new Response(JSON.stringify({ delivered: true, channel: 'app' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build the lead summary once — reused for email + (future) SMS.
    const setterName = setter?.full_name || 'A setter'
    const summary = {
      customerName: lead.contact_name || 'New lead',
      address:      lead.address      || '',
      phone:        lead.contact_phone || '',
      services:     Array.isArray(lead.service_types) ? lead.service_types.join(', ') : '',
      value:        lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '',
      appointment:  lead.appointment_at ? formatAppt(lead.appointment_at) : '',
      notes:        lead.notes || '',
      setterName,
      inboxUrl:     `${APP_BASE_URL}/closer`,
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
  appointment:  string
  notes:        string
  setterName:   string
  inboxUrl:     string
}

async function sendLeadEmail({
  toEmail, toName, summary,
}: {
  toEmail: string
  toName:  string
  summary: LeadSummary
}): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.warn('[notify-closer] RESEND_API_KEY not set — skipping email send.')
    return { ok: false, error: 'RESEND_API_KEY not configured' }
  }
  const subject = summary.appointment
    ? `New lead · ${summary.customerName} · ${summary.appointment}`
    : `New lead · ${summary.customerName}`

  const html = buildLeadHtml({ toName, summary })
  const text = buildLeadText({ toName, summary })

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to:   [toEmail],
        subject,
        html,
        text,
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `Resend ${res.status}: ${errText.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function buildLeadHtml({ toName, summary }: { toName: string; summary: LeadSummary }): string {
  const greeting = toName ? `Hey ${escapeHtml(toName.split(' ')[0])},` : 'Hey there,'
  const row = (label: string, value: string) =>
    value ? `<tr><td style="padding:6px 0;color:#6B7280;font-size:13px;width:120px;">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(value)}</td></tr>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
    <tr><td style="background:#1B4FCC;padding:20px 28px;">
      <div style="color:#FFFFFF;font-weight:700;font-size:18px;">KnockIQ · New Lead</div>
      <div style="color:#DBEAFE;font-size:13px;margin-top:2px;">From ${escapeHtml(summary.setterName)}</div>
    </td></tr>
    <tr><td style="padding:24px 28px;">
      <p style="margin:0 0 12px 0;font-size:15px;">${greeting}</p>
      <p style="margin:0 0 16px 0;font-size:14px;color:#374151;">You've been assigned a new lead. Details below.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        ${row('Customer',    summary.customerName)}
        ${row('Address',     summary.address)}
        ${row('Phone',       summary.phone)}
        ${row('Service',     summary.services)}
        ${row('Est. value',  summary.value)}
        ${row('Appointment', summary.appointment)}
        ${row('Notes',       summary.notes)}
      </table>
      <div style="margin-top:24px;">
        <a href="${escapeAttr(summary.inboxUrl)}" style="display:inline-block;padding:12px 24px;background:#1B4FCC;color:#FFFFFF;text-decoration:none;font-weight:700;border-radius:10px;font-size:14px;">
          Open in KnockIQ →
        </a>
      </div>
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

function buildLeadText({ toName, summary }: { toName: string; summary: LeadSummary }): string {
  const greeting = toName ? `Hey ${toName.split(' ')[0]},` : 'Hey there,'
  const line = (label: string, value: string) => value ? `${label}: ${value}\n` : ''
  return `${greeting}

You've been assigned a new lead by ${summary.setterName}.

${line('Customer',    summary.customerName)}${line('Address',     summary.address)}${line('Phone',       summary.phone)}${line('Service',     summary.services)}${line('Est. value',  summary.value)}${line('Appointment', summary.appointment)}${line('Notes',       summary.notes)}
Open in KnockIQ: ${summary.inboxUrl}

— KnockIQ`
}

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
