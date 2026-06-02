/**
 * CloserHome — the stripped-down inbox closers see when they log in.
 *
 * Lives at /closer. Closers are role='closer' users assigned leads by
 * setters (via setter_picks routing) or by managers (manager_assigns).
 * This screen is intentionally narrow:
 *
 *   • One list view: their assigned leads, grouped by stage.
 *   • One action surface per card: advance stage, mark won/lost, add notes.
 *   • No GPS, no canvassing, no territories, no other closers' leads.
 *
 * Data source: getMyAssignedLeads() — pulls interactions where
 * closer_id = auth.uid() AND stage IN active stages. RLS (added in
 * the 20260602 migration) double-enforces the closer's narrow lane.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Inbox, ChevronRight, MapPin, Phone, Calendar, Check, X,
  AlertCircle, Settings, LogOut, Loader2, DollarSign,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getMyAssignedLeads, updateLeadStage, signOut,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

// Stage display config. Order = pipeline progression. Each lead is
// rendered in its own collapsible stage section.
const STAGE_GROUPS = [
  { id: 'appt_scheduled', title: 'Appointments',   color: '#7C3AED', subtitle: 'Confirmed meetings on your calendar' },
  { id: 'hot_lead',       title: 'Hot Leads',      color: '#F59E0B', subtitle: 'Setter handed these to you — book an appt or send a quote' },
  { id: 'estimate_sent',  title: 'Estimates Sent', color: '#2563EB', subtitle: 'Waiting on the customer to decide' },
  { id: 'booked',         title: 'Booked',         color: '#059669', subtitle: 'Won deals — job pending' },
]

// Lost-reason picker shown when a closer marks an estimate-sent lead lost.
const LOST_REASONS = [
  { id: 'price',      label: 'Price — too expensive' },
  { id: 'timing',     label: 'Timing — pushed to later' },
  { id: 'competitor', label: 'Chose a competitor' },
  { id: 'ghosted',    label: 'Ghosted / stopped responding' },
  { id: 'diy',        label: 'Decided DIY / no longer needed' },
  { id: 'other',      label: 'Other' },
]

export default function CloserHome() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [leads,   setLeads]   = useState([])
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null) // lead id being acted on
  const [lostFor, setLostFor] = useState(null) // lead id showing lost picker

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setLeads(await getMyAssignedLeads())
    setLoading(false)
  }

  async function advance(lead, nextStage, extras = {}) {
    setActing(lead.id)
    const { error } = await updateLeadStage(lead.id, nextStage, extras)
    setActing(null)
    if (error) {
      window.alert(error.message || 'Update failed')
      return
    }
    await load()
  }

  async function markLost(lead, reason) {
    setLostFor(null)
    await advance(lead, 'closed_lost', {
      lost_reason: reason,
      lost_at:     new Date().toISOString(),
    })
  }

  async function handleLogout() {
    if (!window.confirm('Log out?')) return
    await signOut()
    navigate('/login', { replace: true })
  }

  // Group leads by stage so we can render one section per stage.
  const byStage = STAGE_GROUPS.reduce((acc, s) => {
    acc[s.id] = leads.filter((l) => l.stage === s.id)
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div
        className="px-5 pt-10 pb-6"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-white grid place-items-center shrink-0 text-sm font-bold" style={{ color: BRAND_BLUE }}>
            {(user?.full_name || 'C')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">Closer · {user?.full_name || 'You'}</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              Your inbox
            </h1>
          </div>
          <button
            onClick={() => navigate('/closer/profile')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Profile"
          >
            <Settings className="w-5 h-5 text-white" />
          </button>
          <button
            onClick={handleLogout}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Log out"
          >
            <LogOut className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Stat strip */}
        <div className="max-w-3xl mx-auto w-full mt-4 grid grid-cols-4 gap-2">
          {STAGE_GROUPS.map((g) => (
            <div key={g.id} className="bg-white/15 backdrop-blur rounded-xl px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-blue-100 font-semibold truncate">{g.title}</p>
              <p className="text-white text-lg font-extrabold leading-tight">{byStage[g.id]?.length || 0}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-5 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <EmptyState />
        ) : (
          STAGE_GROUPS.map((g) => {
            const list = byStage[g.id]
            if (!list || list.length === 0) return null
            return (
              <section key={g.id}>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                  <h2 className="text-sm font-bold text-gray-800">{g.title}</h2>
                  <span className="text-[11px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                    {list.length}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mb-3 px-1">{g.subtitle}</p>
                <div className="space-y-2.5">
                  {list.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      stage={g}
                      acting={acting === lead.id}
                      showLostPicker={lostFor === lead.id}
                      onAdvance={(stage, extras) => advance(lead, stage, extras)}
                      onShowLost={() => setLostFor(lead.id)}
                      onHideLost={() => setLostFor(null)}
                      onLost={(reason) => markLost(lead, reason)}
                    />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-10 text-center">
      <Inbox className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="text-sm font-semibold text-gray-700">No leads assigned yet</p>
      <p className="text-[12px] text-gray-500 mt-1 leading-snug max-w-sm mx-auto">
        Once a setter books an appointment for you (or your manager routes a lead your
        way), it'll show up here.
      </p>
    </div>
  )
}

function LeadCard({ lead, stage, acting, showLostPicker, onAdvance, onShowLost, onHideLost, onLost }) {
  const setter = lead.users?.full_name || 'a setter'
  const appt = lead.appointment_at ? new Date(lead.appointment_at) : null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5">
      {/* Header row */}
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">
            {lead.contact_name || '—'}
          </p>
          {lead.address && (
            <p className="text-[11px] text-gray-500 truncate flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0" />
              {lead.address}
            </p>
          )}
        </div>
        {lead.estimated_value > 0 && (
          <span className="text-base font-extrabold text-gray-900 shrink-0">
            ${Number(lead.estimated_value).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
        {appt && (
          <span className="flex items-center gap-1 bg-purple-50 text-purple-700 font-semibold px-2 py-0.5 rounded-full">
            <Calendar className="w-3 h-3" />
            {format(appt, 'EEE MMM d · h:mm a')}
          </span>
        )}
        {lead.contact_phone && (
          <a
            href={`tel:${lead.contact_phone}`}
            className="flex items-center gap-1 bg-gray-50 text-gray-700 font-semibold px-2 py-0.5 rounded-full hover:bg-gray-100"
          >
            <Phone className="w-3 h-3" />
            {lead.contact_phone}
          </a>
        )}
        {Array.isArray(lead.service_types) && lead.service_types.length > 0 && (
          <span className="bg-gray-50 text-gray-600 px-2 py-0.5 rounded-full">
            {lead.service_types.slice(0, 2).join(' · ')}
            {lead.service_types.length > 2 && ` +${lead.service_types.length - 2}`}
          </span>
        )}
        <span className="text-gray-400 text-[10px] ml-auto">From {setter}</span>
      </div>

      {/* Notes (if rep left any) */}
      {lead.notes && (
        <p className="mt-2 text-[12px] text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 leading-snug">
          {lead.notes}
        </p>
      )}

      {/* Actions */}
      {!showLostPicker ? (
        <div className="mt-3 flex items-center gap-2">
          {stage.id === 'hot_lead' && (
            <>
              <ActionBtn
                onClick={() => onAdvance('appt_scheduled', { appointment_at: askAppt() })}
                disabled={acting}
                primary
              >
                <Calendar className="w-3.5 h-3.5" /> Book appt
              </ActionBtn>
              <ActionBtn
                onClick={() => onAdvance('estimate_sent', { estimate_sent_at: new Date().toISOString() })}
                disabled={acting}
              >
                <DollarSign className="w-3.5 h-3.5" /> Sent quote
              </ActionBtn>
            </>
          )}
          {stage.id === 'appt_scheduled' && (
            <ActionBtn
              onClick={() => onAdvance('estimate_sent', { estimate_sent_at: new Date().toISOString() })}
              disabled={acting}
              primary
            >
              <DollarSign className="w-3.5 h-3.5" /> Sent estimate
            </ActionBtn>
          )}
          {stage.id === 'estimate_sent' && (
            <ActionBtn
              onClick={() => onAdvance('booked')}
              disabled={acting}
              primary
            >
              <Check className="w-3.5 h-3.5" /> Mark booked
            </ActionBtn>
          )}
          {stage.id !== 'booked' && (
            <button
              onClick={onShowLost}
              disabled={acting}
              className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold text-red-600 hover:bg-red-50"
            >
              <X className="w-3.5 h-3.5 inline -mt-0.5" /> Mark lost
            </button>
          )}
          {acting && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        </div>
      ) : (
        <LostPicker onPick={onLost} onCancel={onHideLost} />
      )}
    </div>
  )
}

function ActionBtn({ children, onClick, disabled, primary }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

function LostPicker({ onPick, onCancel }) {
  return (
    <div className="mt-3 bg-red-50 rounded-lg p-2.5 border border-red-200">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-bold text-red-700 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> Why was this lost?
        </p>
        <button onClick={onCancel} className="text-red-400 hover:text-red-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LOST_REASONS.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick(r.id)}
            className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-700 hover:bg-red-100 font-semibold"
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Lightweight appointment picker — for now we use a window.prompt with
 * datetime-local placeholder text. Phase 3 will replace this with a proper
 * inline date/time picker once we wire the canvassing flow's appt-booking
 * modal. Returning null means the closer cancelled.
 */
function askAppt() {
  const iso = window.prompt(
    'Appointment date/time (e.g. 2026-06-05T14:00). Cancel to skip.',
    nextBusinessHour(),
  )
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    window.alert('Invalid date/time. Try again.')
    return null
  }
  return d.toISOString()
}

function nextBusinessHour() {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  // Format as YYYY-MM-DDTHH:MM (local, no tz suffix) for the prompt placeholder.
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
