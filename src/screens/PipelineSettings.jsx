/**
 * PipelineSettings — manager-only configuration for the Pipeline tab.
 *
 * Lives at /settings/pipeline. Reached from Settings → "Pipeline" tile.
 * Lets the org owner pick:
 *
 *   1. Sales cycle           — appointment_based | quick_quote | mixed
 *      Drives which kanban columns render and whether the canvasser is
 *      forced to pick an appointment time when logging a Hot Lead.
 *
 *   2. Lead routing mode     — setter_picks | round_robin |
 *                              manager_assigns | territory_based
 *      Drives the closer-assignment UI shown to the rep at the door.
 *
 *   3. Quote follow-up SLA   — 1–240 hours
 *      For quick-quote orgs: how long after a Hot Lead the rep has to send
 *      the quote before it shows up in the action queue.
 *
 *   4. Hot Lead stale window — 1–90 days
 *      How long a Hot Lead can sit untouched in the first kanban column
 *      before it auto-graduates to Closed — Stale.
 *
 * All four columns ship with sensible defaults from the migration, so a
 * brand-new org sees a working page immediately and only revisits settings
 * once they want to tune the experience.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Workflow, UserPlus, Clock, Hourglass,
  Check, Loader2,
} from 'lucide-react'
import {
  getMyOrganization, updateOrganizationPipelineConfig,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

// Single source of truth for the picker copy — keeping it next to the
// component so a new value (e.g. a 5th routing mode) is one diff to add.
const SALES_CYCLE_OPTIONS = [
  {
    id:          'appointment_based',
    title:       'Appointment-based',
    description: 'Roofing, solar, HVAC, remodel. Rep books an in-home appointment at the door; the estimate is delivered after the visit.',
  },
  {
    id:          'quick_quote',
    title:       'Quick quote',
    description: 'Window cleaning, pest, exterior, lawn. Rep gives a price on the spot or sends a quote within 24 hrs — no formal appointment needed.',
  },
  {
    id:          'mixed',
    title:       'Mixed',
    description: 'Both flows happen. The kanban shows all four columns and the rep picks per-deal whether an appointment is needed.',
  },
]

const ROUTING_OPTIONS = [
  {
    id:          'manager_assigns',
    title:       'Manager dispatches',
    description: 'Setter logs the appt unassigned. You assign a closer from the Pipeline tab. Best if you want control over high-value deals.',
  },
  {
    id:          'setter_picks',
    title:       'Setter picks at the door',
    description: 'Knocker chooses an available closer from a dropdown when logging the lead. Fastest, but assumes setters know who is available.',
  },
  {
    id:          'round_robin',
    title:       'Round-robin auto-assign',
    description: 'App assigns the next closer in rotation. Fair, removes decision fatigue, treats all leads equally.',
  },
  {
    id:          'territory_based',
    title:       'Territory-based routing',
    description: 'Auto-route by zip code or service type using your closer coverage map. Most sophisticated — requires setting closer territories first.',
  },
]

export default function PipelineSettings() {
  const navigate = useNavigate()

  const [org,          setOrg]          = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [toast,        setToast]        = useState(null)

  // Local edit state — hydrated from the org row on load. Saved in one
  // PATCH per section so the manager doesn't see ghost-changed values
  // bouncing in and out of the UI on slow networks.
  const [salesCycle,       setSalesCycle]       = useState('mixed')
  const [routingMode,      setRoutingMode]      = useState('manager_assigns')
  const [followupHrs,      setFollowupHrs]      = useState('24')
  const [staleDays,        setStaleDays]        = useState('14')

  useEffect(() => {
    (async () => {
      const o = await getMyOrganization()
      if (o) {
        setOrg(o)
        setSalesCycle (o.sales_cycle          || 'mixed')
        setRoutingMode(o.lead_routing_mode    || 'manager_assigns')
        setFollowupHrs(String(o.quote_followup_hours ?? 24))
        setStaleDays  (String(o.hot_lead_stale_days  ?? 14))
      }
      setLoading(false)
    })()
  }, [])

  async function save(patch) {
    if (!org?.id) return
    setSaving(true)
    const { error } = await updateOrganizationPipelineConfig(org.id, patch)
    setSaving(false)
    if (error) {
      setToast({ type: 'error', text: error.message || 'Save failed' })
    } else {
      setToast({ type: 'success', text: 'Saved' })
    }
    setTimeout(() => setToast(null), 2200)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-12">

      {/* Header */}
      <div
        className="px-5 pt-10 pb-6"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back to settings"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">Settings · Pipeline</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              Pipeline configuration
            </h1>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-6 space-y-6">

        {/* ── Section 1: Sales cycle ──────────────────────────────────── */}
        <Section
          icon={<Workflow className="w-4 h-4" />}
          title="Sales cycle"
          subtitle="Determines which pipeline stages your team uses and what the rep is asked at the door."
        >
          <OptionList
            options={SALES_CYCLE_OPTIONS}
            value={salesCycle}
            onChange={(id) => {
              setSalesCycle(id)
              save({ salesCycle: id })
            }}
          />
        </Section>

        {/* ── Section 2: Lead routing mode ────────────────────────────── */}
        <Section
          icon={<UserPlus className="w-4 h-4" />}
          title="Lead routing"
          subtitle="When a setter books a high-ticket appointment, how should we decide which closer it goes to?"
        >
          <OptionList
            options={ROUTING_OPTIONS}
            value={routingMode}
            onChange={(id) => {
              setRoutingMode(id)
              save({ leadRoutingMode: id })
            }}
          />
          {routingMode === 'territory_based' && (
            <p className="mt-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Heads up: territory-based routing requires you to assign coverage zones
              to each closer first. Until you do, leads will route to "manager dispatches" as a fallback.
            </p>
          )}
        </Section>

        {/* ── Section 3: Quote follow-up SLA ──────────────────────────── */}
        <Section
          icon={<Hourglass className="w-4 h-4" />}
          title="Quote follow-up SLA"
          subtitle="For quick-quote leads: how many hours after a Hot Lead is logged should the rep send the quote? Triggers the 'follow-up overdue' card in the action queue."
        >
          <NumberInput
            value={followupHrs}
            onChange={setFollowupHrs}
            onCommit={(v) => save({ quoteFollowupHrs: v })}
            min={1} max={240}
            suffix="hours"
            hint="Default 24 = next business day."
          />
        </Section>

        {/* ── Section 4: Hot Lead stale window ────────────────────────── */}
        <Section
          icon={<Clock className="w-4 h-4" />}
          title="Hot Lead stale window"
          subtitle="How long a Hot Lead can sit untouched in the first kanban column before it auto-graduates to Closed — Stale."
        >
          <NumberInput
            value={staleDays}
            onChange={setStaleDays}
            onCommit={(v) => save({ hotLeadStaleDays: v })}
            min={1} max={90}
            suffix="days"
            hint="Default 14 days. Tighter values (3–5) suit quick-quote cycles; looser (21–30) suit large-ticket appt-based flows."
          />
        </Section>

      </div>

      {/* Save toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div
            className={`px-4 py-2 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2 ${
              toast.type === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-gray-900 text-white'
            }`}
          >
            {toast.type === 'success' && <Check className="w-4 h-4" />}
            {toast.text}
          </div>
        </div>
      )}

      {saving && (
        <div className="fixed bottom-6 right-6 z-40 bg-white border border-gray-200 shadow-sm rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs text-gray-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Saving…
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function Section({ icon, title, subtitle, children }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-50"
            style={{ color: BRAND_BLUE }}
          >
            {icon}
          </div>
          <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        </div>
        {subtitle && (
          <p className="text-[12px] text-gray-500 mt-1.5 leading-snug">{subtitle}</p>
        )}
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </section>
  )
}

function OptionList({ options, value, onChange }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const active = opt.id === value
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`w-full text-left rounded-xl border p-3 transition-colors ${
              active
                ? 'border-blue-600 bg-blue-50/60'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  active ? 'border-blue-600' : 'border-gray-300'
                }`}
              >
                {active && <span className="w-2 h-2 rounded-full bg-blue-600" />}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${active ? 'text-blue-900' : 'text-gray-900'}`}>
                  {opt.title}
                </p>
                <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
                  {opt.description}
                </p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * NumberInput — bounded numeric field. `onChange` fires per keystroke (so
 * the field stays controlled), `onCommit` fires on blur/Enter with a
 * clamped integer so we don't spam the server with intermediate values.
 */
function NumberInput({ value, onChange, onCommit, min, max, suffix, hint }) {
  function commit() {
    const n = parseInt(value, 10)
    if (Number.isNaN(n)) return
    const clamped = Math.max(min, Math.min(max, n))
    onChange(String(clamped))
    onCommit(clamped)
  }
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
          className="w-24 px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold tabular-nums focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
        />
        <span className="text-sm text-gray-600">{suffix}</span>
        <span className="text-[11px] text-gray-400 ml-2">{min}–{max}</span>
      </div>
      {hint && (
        <p className="text-[12px] text-gray-500 mt-1.5 leading-snug">{hint}</p>
      )}
    </div>
  )
}
