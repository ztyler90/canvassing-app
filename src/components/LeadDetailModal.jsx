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
  getAllClosers, updateLeadStage, updateLeadPrice,
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

  useEffect(() => {
    getAllClosers().then(setClosers).catch(() => setClosers([]))
  }, [])

  async function advance(toStage, extras = {}) {
    setSaving(true); setError('')
    const { data, error } = await updateLeadStage(lead.id, toStage, extras)
    setSaving(false)
    if (error) { setError(error.message || 'Update failed'); return }
    onUpdate?.(data)
    onClose?.()
  }

  async function reassign(newCloserId) {
    setReassigning(true); setError('')
    const { data, error } = await updateLeadStage(lead.id, lead.stage, {
      // updateLeadStage doesn't accept closer_id in its extras whitelist by
      // default, but PipelineTab uses the same patch endpoint — passing it
      // via the unrestricted .from('interactions').update() is fine via
      // the rep manager RLS policy on this row.
    })
    // Above is a no-op; the real update goes through supabase directly:
    const { supabase } = await import('../lib/supabase.js')
    const { data: row, error: err2 } = await supabase
      .from('interactions')
      .update({ closer_id: newCloserId || null })
      .eq('id', lead.id)
      .select()
      .single()
    setReassigning(false)
    if (err2) { setError(err2.message || 'Reassign failed'); return }
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

  const stageIdx     = STAGE_ORDER.findIndex((s) => s.id === lead.stage)
  const nextStage    = STAGE_ORDER[stageIdx + 1]
  const setterName   = lead.setter?.full_name || lead.users?.full_name || '—'
  const closerName   = lead.closer?.full_name || '—'

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
            {lead.appointment_at && (
              <div className="flex items-center gap-2 bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full">
                <Calendar className="w-4 h-4" />
                <span className="text-sm font-bold">
                  {format(new Date(lead.appointment_at), 'EEE MMM d · h:mm a')}
                </span>
              </div>
            )}
            {lead.follow_up && (
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-bold">
                🏴 Follow-up flagged
              </span>
            )}
          </div>

          {/* Contact info */}
          <Section title="Contact">
            <Field icon={<User className="w-4 h-4" />}  label="Name"
                   value={lead.contact_name || '—'} />
            <Field icon={<MapPin className="w-4 h-4" />} label="Address"
                   value={lead.address || '—'} />
            <Field icon={<Phone className="w-4 h-4" />}  label="Phone"
                   value={lead.contact_phone || '—'}
                   linkHref={lead.contact_phone ? `tel:${lead.contact_phone}` : null} />
            <Field icon={<Mail className="w-4 h-4" />}   label="Email"
                   value={lead.contact_email || '—'}
                   linkHref={lead.contact_email ? `mailto:${lead.contact_email}` : null} />
            {Array.isArray(lead.service_types) && lead.service_types.length > 0 && (
              <Field label="Services" value={lead.service_types.join(' · ')} />
            )}
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
                <select
                  value={lead.closer_id || ''}
                  onChange={(e) => reassign(e.target.value)}
                  disabled={reassigning}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-blue-400 focus:outline-none bg-white disabled:opacity-50"
                >
                  <option value="">— Unassigned —</option>
                  {closers.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
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

function TimelineRow({ label, age, done }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${done ? 'bg-blue-600' : 'bg-gray-200'}`} />
      <span className={`text-sm flex-1 ${done ? 'text-gray-800' : 'text-gray-400'}`}>{label}</span>
      <span className={`text-[11px] tabular-nums ${done ? 'text-gray-500' : 'text-gray-300'}`}>{age}</span>
    </div>
  )
}
