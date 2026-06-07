/**
 * notify-managers · pipeline-phase notification dispatcher
 *
 * Sibling of notify-closer. Where notify-closer emails the ONE closer a
 * lead was assigned to, this fans out to every MANAGER in the org who has
 * subscribed to the phase the lead just entered.
 *
 * Called from the client (best-effort) right after a lead transitions into
 * a notifiable phase. The single client helper `notifySubscribedManagers`
 * is wired into the data-layer chokepoints (logInteraction / updateLeadStage
 * / updateLeadAppointment) so every path that moves a lead — door log,
 * manager advance, closer advance, appointment set — funnels through here.
 * That structural placement is deliberate: the closer-assignment bug was a
 * missed notify hook in one UI path, and centralizing dispatch in the data
 * layer makes that class of miss impossible.
 *
 * Phases (must match the CHECK in 20260607_managers_and_notifications):
 *   'hot_lead'    — lead became a Hot Lead
 *   'appointment' — lead hit Appt Scheduled OR Estimate Sent (combined)
 *   'booked'      — job booked
 *
 * Recipients for a phase = union of:
 *   • public.users role='manager' in the org whose manager_notify_phases
 *     contains the phase (this includes the owner)
 *   • manager_contacts (email-only) in the org, not promoted, whose
 *     notify_phases contains the phase
 *
 * Auth model: verify_jwt=true. The caller (rep/closer/manager) must be
 * signed in and belong to the same org as the lead — no cross-org pings.
 * Never throws; a missed manager email must never roll back the lead change
 * that triggered it.
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmail, brandedEmail, brandedText, firstNameGreeting } from '../_shared/email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') || 'https://app.knockiq.com').replace(/\/$/, '')

const VALID_PHASES = ['hot_lead', 'appointment', 'booked'] as const
type Phase = typeof VALID_PHASES[number]

// Map a raw stage to its notification phase bucket. Mirrors PHASE_FOR_STAGE
// on the client. Non-notifiable stages (closed_*, null) return null.
function phaseForStage(stage: string | null | undefined): Phase | null {
  switch (stage) {
    case 'hot_lead':       return 'hot_lead'
    case 'appt_scheduled': return 'appointment'
    case 'estimate_sent':  return 'appointment'
    case 'booked':         return 'booked'
    default:               return null
  }
}

// Per-phase email copy. The stage is passed through so the combined
// 'appointment' phase can say specifically "appointment scheduled" vs
// "estimate sent" — the toggle is combined but the email stays precise.
function phaseCopy(phase: Phase, stage: string | null): { eyebrow: string; heading: string; lead: string } {
  if (phase === 'hot_lead') {
    return { eyebrow: 'Pipeline update', heading: 'New Hot Lead', lead: 'A new hot lead just entered the pipeline.' }
  }
  if (phase === 'booked') {
    return { eyebrow: 'Pipeline update', heading: 'Job Booked', lead: 'A job was just booked. Nice work, team.' }
  }
  // appointment phase — disambiguate by stage
  if (stage === 'estimate_sent') {
    return { eyebrow: 'Pipeline update', heading: 'Estimate Sent', lead: 'An estimate was just sent to a customer.' }
  }
  return { eyebrow: 'Pipeline update', heading: 'Appointment Scheduled', lead: 'An appointment was just scheduled.' }
}

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

    const { interactionId, phase: phaseArg } = await req.json()
    if (!interactionId) {
      return new Response(JSON.stringify({ error: 'interactionId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Pull the lead. We re-derive the phase from the lead's own stage rather
    // than trusting the client arg blindly — the client passes phaseArg as a
    // hint, but the DB row is the source of truth.
    const { data: lead, error: leadErr } = await adminClient
      .from('interactions')
      .select(`
        id, organization_id, stage, address, contact_name, contact_phone,
        contact_email, service_types, estimated_value, service_line_items, notes, appointment_at,
        rep_id, setter:rep_id ( id, full_name )
      `)
      .eq('id', interactionId)
      .single()

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const phase = phaseForStage(lead.stage)
    if (!phase) {
      // Lead isn't in a notifiable phase (e.g. it advanced again, or was
      // closed). Quietly succeed so the client can fire defensively.
      return new Response(JSON.stringify({ delivered: false, reason: 'not-a-notifiable-phase' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // If the client sent a hint and it disagrees with the row, trust the row
    // but note it (helps debug a stale client).
    if (phaseArg && VALID_PHASES.includes(phaseArg) && phaseArg !== phase) {
      console.warn(`[notify-managers] phase hint "${phaseArg}" != derived "${phase}" for ${interactionId}`)
    }

    // Same-org guard. Caller must belong to the lead's org.
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

    // ── Gather subscribers ────────────────────────────────────────────────
    // Platform managers: role='manager' in this org whose subscription array
    // contains the phase. `contains` maps to the @> array operator.
    const [{ data: platformMgrs }, { data: contactMgrs }] = await Promise.all([
      adminClient
        .from('users')
        .select('id, email, full_name, manager_notify_phases')
        .eq('organization_id', lead.organization_id)
        .eq('role', 'manager')
        .contains('manager_notify_phases', [phase]),
      adminClient
        .from('manager_contacts')
        .select('id, email, full_name, notify_phases')
        .eq('organization_id', lead.organization_id)
        .is('promoted_to_user_id', null)
        .contains('notify_phases', [phase]),
    ])

    // De-dupe by lowercased email (a person could be both a platform manager
    // and an email-only contact). First occurrence wins.
    const recipients = new Map<string, { email: string; name: string }>()
    for (const m of (platformMgrs || [])) {
      if (m.email) recipients.set(m.email.toLowerCase(), { email: m.email, name: m.full_name || '' })
    }
    for (const c of (contactMgrs || [])) {
      if (c.email && !recipients.has(c.email.toLowerCase())) {
        recipients.set(c.email.toLowerCase(), { email: c.email, name: c.full_name || '' })
      }
    }

    if (recipients.size === 0) {
      return new Response(JSON.stringify({ delivered: false, reason: 'no-subscribers', phase }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Build the email once (recipient name is injected per-send) ────────
    const copy = phaseCopy(phase, lead.stage)
    const setterName = (lead as any).setter?.full_name || 'A setter'
    const rows = [
      { label: 'Customer',    value: lead.contact_name || 'New lead' },
      { label: 'Address',     value: lead.address || '' },
      { label: 'Phone',       value: lead.contact_phone || '' },
      { label: 'Service',     value: Array.isArray(lead.service_types) ? lead.service_types.join(', ') : '' },
      { label: 'Est. value',  value: lead.estimated_value ? `$${Number(lead.estimated_value).toLocaleString()}` : '' },
      // Itemized per-service breakdown (only when the rep priced each service
      // at the door). Empty rows are dropped by brandedEmail, so this is
      // invisible for single-value estimates.
      { label: 'Itemized',    value: Array.isArray(lead.service_line_items)
          ? lead.service_line_items.map((li) => `${li?.service ?? ''}: $${Number(li?.price || 0).toLocaleString()}`).join(' · ')
          : '' },
      { label: 'Appointment', value: lead.appointment_at ? formatAppt(lead.appointment_at) : '' },
      { label: 'Logged by',   value: setterName },
    ]

    const results = await Promise.all(
      [...recipients.values()].map(async (r) => {
        const opts = {
          eyebrow:  copy.eyebrow,
          heading:  copy.heading,
          greeting: firstNameGreeting(r.name),
          intro:    [copy.lead, 'You\'re receiving this because you subscribed to these pipeline updates.'],
          rows,
          cta: { label: 'Open the pipeline →', url: `${APP_BASE_URL}/manager` },
          footnote: 'Manage which updates you get under Settings → Managers.',
        }
        const subject = `${headingEmoji(phase)} ${copy.heading} · ${lead.contact_name || 'New lead'}`
        const res = await sendEmail({
          to:   r.email,
          subject,
          html: brandedEmail(opts),
          text: brandedText(opts),
        })
        return { email: r.email, ok: res.ok, error: res.error }
      })
    )

    const sent = results.filter((x) => x.ok).length
    return new Response(JSON.stringify({
      delivered: sent > 0,
      phase,
      sent,
      total:  results.length,
      errors: results.filter((x) => !x.ok).map((x) => ({ email: x.email, error: x.error })),
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[notify-managers] Unhandled error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

function headingEmoji(phase: Phase): string {
  if (phase === 'hot_lead') return '🔥'
  if (phase === 'booked')   return '✅'
  return '📅'
}

function formatAppt(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
