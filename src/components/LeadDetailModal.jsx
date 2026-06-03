/**
 * LeadDetailModal — manager's drill-down view for a single pipeline lead.
 *
 * Opens when a card is clicked in PipelineTab (kanban, action queue, or
 * calendar strip). Shows everything the rep + closer have logged about
 * the lead plus inline manager actions:
 *
 *   • Full contact info, address, services, $ value
 *   • Free-form notes (what the rep heard at the door)
 *   • Photo thumbnails
 *   • Appointment date/time + setter + closer names
 *   • Funnel timeline (hot lead → estimate sent → booked)
 *   • Reassign closer (dropdown of closers in org)
 *   • Advance stage (Hot Lead → Appt Scheduled → Estimate Sent → Booked)
 *   • Mark Lost with reason picker
 *
 * Kept presentational — calls back to onUpdate so PipelineTab can refresh
 * its in-memory list after a stage/closer change without a full reload.
 */
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  X, MapPin, Phone, Mail, Calendar, User, DollarSign, Loader2, Check,
  Clock, AlertCircle, UserCheck, ChevronRight, ChevronDown,
} from 'lucide-react'
import { PhotoThumb } from '../lib/photos.jsx'
import {
  getAllClosersUnified, updateLeadStage, updateLeadPrice, updateLeadAppointment,
  updateLeadContact, setLeadCloser,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

// Same lost-reason taxonomy used in CloserHome's estimate-stage picker.
// Door-stage reasons are handled at the InteractionModal step before
// the lead ever enters the pipeline.
const LOST_REASONS = [
  { id: 'price',      label: 'Price — too expensive' },
  { id: 'timing',     label: 'Timing — pushed to later' },
  { id: 'competitor', label: 'Chose a competitor' },
  { id: 'ghosted',    label: 'Ghosted / no response' },
  { id: 'diy',        label: 'Decided DIY / no longer needed' },
  { id: 'other',      label: 'Other' },
]

// Stage display config — used for the timeline and the advance buttons.
const STAGE_ORDER = [
  { id: 'hot_lead',       label: 'Hot Lead'        },
  { id: 'appt_scheduled', label: 'Appt Scheduled'  },
  { id: 'estimate_sent',  label: 'Estimate Sent'   },
  { id: 'booked',         label: 'Booked'          },
]

export default function LeadDetailModal({ lead, onClose, onUpdate }) {
  const [closers,      setClosers]      = useState([])
  const [saving,       setSaving]       = useState(false)
  const [showLost,     setShowLost]     = useState(false)
  const [lostReason,   setLostReason]   = useState(null)
  const [lostNotes,    setLostNotes]    = useState('')
  const [reassigning,  setReassigning]  = useState(false)
  const [error,        setError]        = useState('')
  // Inline price editor — managers revise the quoted value here when a
  // closer's actual estimate comes back different from what the setter
  // logged at the door. Click the $ amount to enter edit mode; blur or
  // Enter commits; Escape reverts. Saving is optimistic so the kanban
  // card behind the modal updates immediately on close.
  const [editingPrice, setEditingPrice] = useState(false)
  const [priceDraft,   setPriceDraft]   = useState(
    lead.estimated_value != null ? String(lead.estimated_value) : ''
  )
  const [savingPrice,  setSavingPrice]  = useState(false)
  // Same inline-edit pattern for the appointment date/time. The native
  // datetime-local input gives a calendar + clock picker on every
  // platform without us shipping a custom widget. Stored locally as a
  // tz-naive "YYYY-MM-DDTHH:MM" string while editing, then converted to
  // ISO on save so the DB column stays canonical UTC.
  const [editingAppt, setEditingAppt] = useState(false)
  const [apptDraft,   setApptDraft]   = useState(
    lead.appointment_at ? isoToLocalInput(lead.appointment_at) : ''
  )
  const [savingAppt,  setSavingAppt]  = useState(false)

  useEffect(() => {
    getAllClosersUnified().then(setClosers).catch(() => setClosers([]))
  }, [])

  async function advance(toStage, extras = {}) {
    setSaving(true); setError('')
    const { data, error } = await updateLeadStage(lead.id, toStage, extras)
    setSaving(false)
    if (error) { setError(error.message || 'Update failed'); return }
    onUpdate?.(data)
    onClose?.()
  }

  async function reassign(closerKey) {
    // closerKey is the composite "tier:id" string from the dropdown, or
    // empty to unassign. setLeadCloser handles the XOR write — it sets
    // the right column (closer_id or closer_contact_id) and nulls the
    // other one so the DB CHECK constraint is satisfied.
    setReassigning(true); setError('')
    const pick = closerKey
      ? (() => {
          const [tier, id] = closerKey.split(':')
          return { tier, id }
        })()
      : null
    const { data: row, error: err } = await setLeadCloser(lead.id, pick)
    setReassigning(false)
    if (err) {
      setError(err.message || "Couldn't update this lead — refresh and try again.")
      return
    }
    onUpdate?.(row)
  }

  async function markLost() {
    if (!lostReason) return
    await advance('closed_lost', {
      lost_reason:       lostReason,
      lost_reason_notes: lostNotes || null,
      lost_at:           new Date().toISOString(),
    })
  }

  async function commitPrice() {
    // Original lead value + the local draft are both stringified to compare
    // — saves a round trip when the manager opens the editor but doesn't
    // change anything.
    const original = lead.estimated_value != null ? String(lead.estimated_value) : ''
    if (priceDraft === original) { setEditingPrice(false); return }
    setSavingPrice(true); setError('')
    const { data, error } = await updateLeadPrice(lead.id, priceDraft === '' ? null : priceDraft)
    setSavingPrice(false)
    if (error) { setError(error.message || 'Price save failed'); return }
    setEditingPrice(false)
    onUpdate?.(data)
  }

  /**
   * Shared save handler used by every editable contact field. Each field
   * passes its column key and new value; we patch just that one column
   * via updateLeadContact and let the parent's onUpdate refresh the
   * cached row. Errors surface in the modal-level error banner.
   *
   * Returns true on success so EditableField knows to exit edit mode.
   */
  async function saveContactField(key, value) {
    setError('')
    const patch = key === 'service_types'
      ? { service_types: parseServiceList(value) }
      : { [key]: value }
    const { data, error } = await updateLeadContact(lead.id, patch)
    if (error) { setError(error.message || 'Save failed'); return false }
    onUpdate?.(data)
    return true
  }

  async function commitAppt() {
    const original = lead.appointment_at ? isoToLocalInput(lead.appointment_at) : ''
    if (apptDraft === original) { setEditingAppt(false); return }
    const iso = apptDraft ? localInputToIso(apptDraft) : null
    if (apptDraft && !iso) {
      setError('Invalid date/time')
      return
    }
    setSavingAppt(true); setError('')
    const { data, error } = await updateLeadAppointment(lead.id, iso)
    setSavingAppt(false)
    if (error) { setError(error.message || 'Appointment save failed'); return }
    setEditingAppt(false)
    onUpdate?.(data)
  }

  const stageIdx     = STAGE_ORDER.findIndex((s) => s.id === lead.stage)
  const nextStage    = STAGE_ORDER[stageIdx + 1]
  const setterName   = lead.setter?.full_name || lead.users?.full_name || '—'
  // Closer name comes from whichever side of the two-tier model is set
  // on this lead. The currentCloserKey drives the dropdown selection.
  const closerName = lead.closer?.full_name
    || lead.closer_contact?.full_name
    || '—'
  const currentCloserKey = lead.closer_id
    ? `platform:${lead.closer_id}`
    : lead.closer_contact_id
      ? `contact:${lead.closer_contact_id}`
      : ''

  // Convert ISO → "5d ago"-style aging label. Used for the timeline rows.
  const fmtAge = (iso) => {
    if (!iso) return '—'
    const d = (Date.now() - new Date(iso).getTime()) / 86_400_000
    if (d < 1) return 'today'
    return `${Math.round(d)}d ago`
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-3xl shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
              Lead detail · {STAGE_ORDER.find((s) => s.id === lead.stage)?.label || lead.stage}
            </p>
            <h2 className="text-lg font-bold text-gray-900 truncate">
              {lead.contact_name || '—'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">

          {/* Top-line: $ value + appt time.
              The $ amount is click-to-edit so a manager can revise the
              quoted price when the closer's actual estimate comes in
              different from what the setter logged at the door. The
              "Edit price" affordance shows on hover or whenever the value
              is missing entirely, so this also doubles as a "set initial
              price" surface for leads logged without one. */}
          <div className="flex items-center gap-4 flex-wrap">
            {!editingPrice ? (
              <button
                type="button"
                onClick={() => {
                  setPriceDraft(lead.estimated_value != null ? String(lead.estimated_value) : '')
                  setEditingPrice(true)
                }}
                className="group flex items-center gap-2 rounded-lg px-2 py-1 -ml-2 hover:bg-green-50 transition-colors"
                title="Click to edit price"
              >
                <DollarSign className="w-5 h-5 text-green-700" />
                {lead.estimated_value > 0 ? (
                  <span className="text-2xl font-extrabold text-gray-900">
                    ${Number(lead.estimated_value).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-gray-400 italic">Set price…</span>
                )}
                <span className="text-[10px] uppercase font-bold tracking-wider text-green-700 opacity-0 group-hover:opacity-100 transition-opacity">
                  edit
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-green-50 rounded-lg px-2 py-1 -ml-2 border-2 border-green-400">
                <DollarSign className="w-5 h-5 text-green-700 shrink-0" />
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="100"
                  autoFocus
                  value={priceDraft}
                  onChange={(e) => setPriceDraft(e.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur() }
                    if (e.key === 'Escape') {
                      setPriceDraft(lead.estimated_value != null ? String(lead.estimated_value) : '')
                      setEditingPrice(false)
                    }
                  }}
                  className="text-2xl font-extrabold text-gray-900 bg-transparent outline-none w-32 tabular-nums"
                  placeholder="0"
                />
                {savingPrice && <Loader2 className="w-4 h-4 animate-spin text-green-700" />}
              </div>
            )}
            {/* Click-to-edit appointment time. Mirrors the price edit
                pattern. If no appointment is set, the pill becomes a
                "Set appointment time…" button — same surface for both
                rescheduling and first-time scheduling. Saving from a
                Hot Lead also promotes the stage (helper handles that). */}
            {!editingAppt ? (
              <button
                type="button"
                onClick={() => {
                  setApptDraft(lead.appointment_at ? isoToLocalInput(lead.appointment_at) : '')
                  setEditingAppt(true)
                }}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
                  lead.appointment_at
                    ? 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
                title={lead.appointment_at ? 'Click to reschedule' : 'Click to set appointment'}
              >
                <Calendar className="w-4 h-4" />
                <span className="text-sm font-bold">
                  {lead.appointment_at
                    ? format(new Date(lead.appointment_at), 'EEE MMM d · h:mm a')
                    : 'Set appointment time…'}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                  edit
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-purple-50 px-3 py-1.5 rounded-full border-2 border-purple-400">
                <Calendar className="w-4 h-4 text-purple-700 shrink-0" />
                <input
                  type="datetime-local"
                  autoFocus
                  value={apptDraft}
                  onChange={(e) => setApptDraft(e.target.value)}
                  onBlur={commitAppt}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur() }
                    if (e.key === 'Escape') {
                      setApptDraft(lead.appointment_at ? isoToLocalInput(lead.appointment_at) : '')
                      setEditingAppt(false)
                    }
                  }}
                  className="text-sm font-bold text-purple-900 bg-transparent outline-none"
                />
                {apptDraft && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setApptDraft(''); /* commit on blur */ }}
                    className="text-[10px] uppercase font-bold tracking-wider text-purple-700 hover:text-purple-900"
                    title="Clear appointment"
                  >
                    clear
                  </button>
                )}
                {savingAppt && <Loader2 className="w-4 h-4 animate-spin text-purple-700" />}
              </div>
            )}
            {lead.follow_up && (
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-bold">
                🏴 Follow-up flagged
              </span>
            )}
          </div>

          {/* Contact info — every row is click-to-edit so a manager can
              fix a typo without leaving the modal. Phone/email become
              tap-to-call links when not editing; in edit mode they become
              type=tel and type=email inputs with appropriate keyboards. */}
          <Section title="Contact">
            <EditableField
              icon={<User className="w-4 h-4" />}
              label="Name"
              value={lead.contact_name}
              placeholder="Add a name…"
              onSave={(v) => saveContactField('contact_name', v)}
            />
            <EditableField
              icon={<MapPin className="w-4 h-4" />}
              label="Address"
              value={lead.address}
              placeholder="Add an address…"
              onSave={(v) => saveContactField('address', v)}
            />
            <EditableField
              icon={<Phone className="w-4 h-4" />}
              label="Phone"
              value={lead.contact_phone}
              placeholder="Add a phone…"
              type="tel"
              linkHref={lead.contact_phone ? `tel:${lead.contact_phone}` : null}
              onSave={(v) => saveContactField('contact_phone', v)}
            />
            <EditableField
              icon={<Mail className="w-4 h-4" />}
              label="Email"
              value={lead.contact_email}
              placeholder="Add an email…"
              type="email"
              linkHref={lead.contact_email ? `mailto:${lead.contact_email}` : null}
              onSave={(v) => saveContactField('contact_email', v)}
            />
            <EditableField
              label="Services"
              value={Array.isArray(lead.service_types) ? lead.service_types.join(', ') : ''}
              placeholder="Comma-separated (e.g. Solar, Battery)…"
              onSave={(v) => saveContactField('service_types', v)}
            />
          </Section>

          {/* Notes — the most-asked-for piece */}
          {lead.notes && (
            <Section title="Notes from the rep">
              <p className="text-sm text-gray-800 bg-amber-50 rounded-xl px-4 py-3 leading-relaxed whitespace-pre-line">
                {lead.notes}
              </p>
            </Section>
          )}

          {/* Photos */}
          {Array.isArray(lead.photo_urls) && lead.photo_urls.length > 0 && (
            <Section title="Photos">
              <div className="flex gap-2 flex-wrap">
                {lead.photo_urls.map((url, i) => (
                  <PhotoThumb
                    key={i}
                    pathOrUrl={url}
                    bucket="interaction-photos"
                    alt={`Photo ${i + 1}`}
                    className="w-20 h-20 rounded-xl object-cover border border-gray-200"
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Assignment */}
          <Section title="Assignment">
            <div className="space-y-3">
              <Field icon={<User className="w-4 h-4" />} label="Setter (rep)"
                     value={setterName} />
              <div>
                <div className="flex items-center gap-2 text-[11px] uppercase font-bold tracking-wide text-gray-400 mb-1.5">
                  <UserCheck className="w-3.5 h-3.5" /> Closer
                </div>
                {/* Closer dropdown — value is the composite "tier:id" so
                    reassign() knows which FK column to write. Email-only
                    contacts get an "(email)" suffix so it's obvious which
                    closers will be notified vs. logging in. */}
                <select
                  value={currentCloserKey}
                  onChange={(e) => reassign(e.target.value)}
                  disabled={reassigning}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none bg-white disabled:opacity-50"
                >
                  <option value="">— Unassigned —</option>
                  {closers.map((c) => (
                    <option key={`${c.tier}:${c.id}`} value={`${c.tier}:${c.id}`}>
                      {c.full_name || c.email}{c.tier === 'contact' ? ' (email)' : ''}
                    </option>
                  ))}
                </select>
                {reassigning && (
                  <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Reassigning…
                  </p>
                )}
              </div>
            </div>
          </Section>

          {/* Funnel timeline */}
          <Section title="Funnel timeline">
            <div className="space-y-1.5">
              <TimelineRow label="Logged at door"   when={lead.created_at} age={fmtAge(lead.created_at)} done />
              <TimelineRow label="Hot Lead started" when={lead.hot_lead_started_at} age={fmtAge(lead.hot_lead_started_at)}
                           done={!!lead.hot_lead_started_at} />
              <TimelineRow label="Appointment set"  when={lead.appointment_at}     age={lead.appointment_at ? format(new Date(lead.appointment_at), 'MMM d · h:mma') : '—'}
                           done={['appt_scheduled','estimate_sent','booked'].includes(lead.stage)} />
              <TimelineRow label="Estimate sent"    when={lead.estimate_sent_at}   age={fmtAge(lead.estimate_sent_at)}
                           done={['estimate_sent','booked'].includes(lead.stage)} />
              <TimelineRow label="Booked"           when={lead.stage === 'booked' ? lead.created_at : null}
                           age={lead.stage === 'booked' ? '✓' : '—'}
                           done={lead.stage === 'booked'} />
            </div>
          </Section>

          {/* Actions */}
          {!showLost ? (
            <div className="flex gap-2 sticky bottom-0 bg-white pt-2 pb-1">
              {nextStage && lead.stage !== 'booked' && (
                <button
                  onClick={() => {
                    const extras = {}
                    if (nextStage.id === 'estimate_sent') extras.estimate_sent_at = new Date().toISOString()
                    advance(nextStage.id, extras)
                  }}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{ background: BRAND_BLUE }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  Advance → {nextStage.label}
                </button>
              )}
              {lead.stage !== 'booked' && (
                <button
                  onClick={() => setShowLost(true)}
                  disabled={saving}
                  className="px-4 py-3 rounded-xl text-sm font-bold text-red-600 bg-red-50 hover:bg-red-100"
                >
                  Mark Lost
                </button>
              )}
            </div>
          ) : (
            <div className="bg-red-50 rounded-xl p-3 border border-red-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-red-700 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> Why was this lost?
                </p>
                <button onClick={() => { setShowLost(false); setLostReason(null) }}
                        className="text-red-500 hover:text-red-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-1.5 mb-2">
                {LOST_REASONS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setLostReason(r.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      lostReason === r.id
                        ? 'bg-red-600 text-white'
                        : 'bg-white text-gray-700 border border-red-200'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              {lostReason === 'other' && (
                <input
                  type="text"
                  value={lostNotes}
                  onChange={(e) => setLostNotes(e.target.value)}
                  placeholder="Tell us more (optional)"
                  className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:border-red-500 focus:outline-none mb-2"
                />
              )}
              <button
                onClick={markLost}
                disabled={!lostReason || saving}
                className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Confirm Lost'}
              </button>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase font-bold tracking-wider text-gray-400 mb-2">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Field({ icon, label, value, linkHref }) {
  return (
    <div className="flex items-start gap-2">
      {icon && <div className="text-gray-400 mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">{label}</p>
        {linkHref ? (
          <a href={linkHref} className="text-sm text-blue-700 font-semibold underline truncate block">
            {value}
          </a>
        ) : (
          <p className="text-sm text-gray-800 font-semibold truncate">{value}</p>
        )}
      </div>
    </div>
  )
}

/**
 * EditableField — click-to-edit row used throughout the Contact section.
 *
 * Mirrors the price + appointment edit pattern: read mode shows the value
 * (with optional tap-to-call/email link), click anywhere on the row to
 * switch to an input, Enter or blur commits, Escape reverts. A faint
 * "edit" hint appears on hover for discoverability.
 *
 * The parent supplies a single `onSave(newValue)` callback returning a
 * Promise<boolean>. True → exit edit mode; false → stay in edit mode with
 * the parent's error already surfaced in the modal-level error banner.
 *
 *   type      — 'text' | 'tel' | 'email' (drives the input element type)
 *   linkHref  — if set and read mode is active, value renders as a link
 *   placeholder — shown when value is empty in BOTH read + edit modes
 */
function EditableField({ icon, label, value, placeholder = '', type = 'text', linkHref, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value || '')
  const [saving,  setSaving]  = useState(false)

  // Re-sync draft when the underlying lead row refreshes (e.g. after a
  // sibling field saved and the parent re-rendered with new props).
  useEffect(() => { if (!editing) setDraft(value || '') }, [value, editing])

  async function commit() {
    const original = value || ''
    const trimmed  = draft.trim()
    if (trimmed === original) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(trimmed)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-start gap-2">
        {icon && <div className="text-gray-400 mt-1.5 shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">{label}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <input
              type={type}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  { e.currentTarget.blur() }
                if (e.key === 'Escape') { setDraft(value || ''); setEditing(false) }
              }}
              placeholder={placeholder}
              className="flex-1 px-2 py-1 border border-blue-400 rounded-lg text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-blue-50/30"
            />
            {saving && <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />}
          </div>
        </div>
      </div>
    )
  }

  const display = value || placeholder
  const isEmpty = !value
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value || '')
        setEditing(true)
      }}
      className="w-full text-left group flex items-start gap-2 rounded-lg px-1 -mx-1 py-0.5 hover:bg-blue-50/40 transition-colors"
      title="Click to edit"
    >
      {icon && <div className="text-gray-400 mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">{label}</p>
          <span className="text-[9px] uppercase font-bold tracking-wider text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
            edit
          </span>
        </div>
        {linkHref && !isEmpty ? (
          // Inside a <button> we can't legally nest an <a> with its own
          // click target; render as a plain span and rely on the modal's
          // outer phone/email link affordances on the top-line row.
          <p className="text-sm text-blue-700 font-semibold underline truncate">{display}</p>
        ) : (
          <p className={`text-sm font-semibold truncate ${isEmpty ? 'text-gray-400 italic' : 'text-gray-800'}`}>
            {display}
          </p>
        )}
      </div>
    </button>
  )
}

// Parse a comma-or-semicolon-separated services string into a clean
// string[]. Used by the Services row in the Contact editor.
function parseServiceList(s) {
  if (!s) return null
  const list = String(s)
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return list.length > 0 ? list : null
}

function TimelineRow({ label, age, done }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${done ? 'bg-blue-600' : 'bg-gray-200'}`} />
      <span className={`text-sm flex-1 ${done ? 'text-gray-800' : 'text-gray-400'}`}>{label}</span>
      <span className={`text-[11px] tabular-nums ${done ? 'text-gray-500' : 'text-gray-300'}`}>{age}</span>
    </div>
  )
}

// ── Timezone helpers ─────────────────────────────────────────────────────
// datetime-local inputs use a tz-naive YYYY-MM-DDTHH:MM string interpreted
// as local time. The DB column is canonical UTC ISO. These convert back
// and forth so the manager sees local times in the picker but we always
// persist UTC.
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(localStr) {
  if (!localStr) return null
  const d = new Date(localStr)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
