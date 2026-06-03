/**
 * PipelineTab — manager's prospect-management workspace.
 *
 * Replaces the legacy BookingsTab. Reached from ManagerDashboard via the
 * "Pipeline" tab. Five zones, top-to-bottom:
 *
 *   1. Action Queue (Pro) — auto-surfaced at-risk leads with one-tap actions
 *   2. Next 10 Days (Pro) — appointment calendar strip with $-on-calendar
 *   3. Open Pipeline (Free) — 4-column kanban: Hot Lead → Appt → Estimate → Booked
 *   4. Closed summary (Pro) — collapsed pill with lost-reason rollup
 *   5. Pipeline health (Pro) — KPI tiles
 *
 * Tier handling: basic users see the kanban only; Pro-gated zones show a
 * locked teaser with an Upgrade CTA. Single component, two render paths,
 * driven by `isPro = org.tier === 'pro'`. Keeps the upsell story visible
 * without forking the file.
 *
 * Data sources (all from supabase.js, all RLS-filtered to caller's org):
 *   getPipelineLeads, getActionQueue, getUpcomingAppointments,
 *   getPipelineHealth, getClosedSummary
 */
import { useEffect, useMemo, useState } from 'react'
import { format, isSameDay, isToday } from 'date-fns'
import {
  Flame, Calendar, Layers, Archive, ChevronDown, ChevronRight,
  MapPin, Phone, Loader2, Lock, Sparkles, TrendingUp, TrendingDown,
  AlertCircle, Clock, DollarSign, Users,
} from 'lucide-react'
import {
  getPipelineLeads, getActionQueue, getUpcomingAppointments,
  getPipelineHealth, getClosedSummary, getMyOrganization,
  ACTIVE_PIPELINE_STAGES,
} from '../lib/supabase.js'
import LeadDetailModal from './LeadDetailModal.jsx'

const BRAND_BLUE = '#1B4FCC'

// Stage display config. Order matches funnel progression. Each stage gets
// its own column background tint + accent dot so columns are distinguishable
// at a glance.
const STAGE_COLUMNS = [
  { id: 'hot_lead',       title: 'Hot Lead',                 bg: 'bg-gray-100/70',   dot: 'bg-amber-500',
    desc: 'Good convo at the door — needs an appt or quote.' },
  { id: 'appt_scheduled', title: 'Appt Scheduled',           bg: 'bg-purple-50/60',  dot: 'bg-purple-500',
    desc: 'Confirmed meeting on the calendar.' },
  { id: 'estimate_sent',  title: 'Estimate Sent',            bg: 'bg-blue-50/60',    dot: 'bg-blue-500',
    desc: 'Quote delivered. Waiting on the customer.' },
  { id: 'booked',         title: 'Booked · Job Pending',     bg: 'bg-green-50/60',   dot: 'bg-green-600',
    desc: 'Won deals — job not yet completed.' },
]

export default function PipelineTab() {
  const [org,              setOrg]              = useState(null)
  const [leads,            setLeads]            = useState([])
  const [queue,            setQueue]            = useState([])
  const [appts,            setAppts]            = useState([])
  const [health,           setHealth]           = useState(null)
  const [closed,           setClosed]           = useState(null)
  const [loading,          setLoading]          = useState(true)
  const [closedExpanded,   setClosedExpanded]   = useState(false)
  // The currently-opened lead, if any. null means no modal. Keyed by full
  // lead object (not just id) so the modal can render its drill-down
  // immediately without re-querying. After an update, we patch the local
  // leads array so the kanban re-renders without a full reload.
  const [openLead,         setOpenLead]         = useState(null)
  // Day-drill modal state. Holds the full { date, appts, totalValue }
  // tuple straight from getUpcomingAppointments so the day modal can
  // render without re-fetching. Lead click inside the day modal sets
  // openLead, which stacks the lead modal on top.
  const [openDay,          setOpenDay]          = useState(null)

  useEffect(() => { load() }, [])

  function handleLeadUpdate(updated) {
    if (!updated) return
    setLeads((prev) => prev.map((l) => l.id === updated.id ? { ...l, ...updated } : l))
    // If the stage changed, the lead may have left the active-pipeline
    // tracked range. Simplest correct thing: trigger a soft refresh so
    // counts stay accurate. Action queue + health are derived from the
    // same set so they refresh too.
    load()
  }

  async function load() {
    setLoading(true)
    const [o, l, q, a, h, c] = await Promise.all([
      getMyOrganization(),
      getPipelineLeads(),
      getActionQueue(),
      getUpcomingAppointments(10),
      getPipelineHealth(30),
      getClosedSummary(30),
    ])
    setOrg(o); setLeads(l); setQueue(q); setAppts(a); setHealth(h); setClosed(c)
    setLoading(false)
  }

  const isPro = org?.tier === 'pro'

  // Group active leads by stage so each kanban column renders from a small
  // local array rather than re-filtering on every render.
  const byStage = useMemo(() => {
    const out = {}
    for (const s of ACTIVE_PIPELINE_STAGES) out[s] = []
    for (const l of leads) {
      if (out[l.stage]) out[l.stage].push(l)
    }
    return out
  }, [leads])

  const totals = useMemo(() => {
    const t = {}
    for (const s of ACTIVE_PIPELINE_STAGES) {
      t[s] = {
        count: byStage[s].length,
        value: byStage[s].reduce((a, l) => a + Number(l.estimated_value || 0), 0),
      }
    }
    const openCount = ACTIVE_PIPELINE_STAGES
      .filter((s) => s !== 'booked')
      .reduce((a, s) => a + t[s].count, 0)
    const openValue = ACTIVE_PIPELINE_STAGES
      .filter((s) => s !== 'booked')
      .reduce((a, s) => a + t[s].value, 0)
    return { byStage: t, openCount, openValue }
  }, [byStage])

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto w-full px-4 py-5 pb-10 space-y-6">

      {/* ── Zone 1: Action Queue (Pro) ───────────────────────────────── */}
      <ProSection
        isPro={isPro}
        icon={<Flame className="w-4 h-4 text-red-600" />}
        title="Needs Action Today"
        badge={queue.length > 0 ? queue.length : null}
        unlockBlurb="See the 3–5 deals slipping through the cracks today. Auto-detected from appointment timing, estimate aging, and follow-up flags."
      >
        {queue.length === 0 ? (
          <EmptyTile icon={<Sparkles className="w-8 h-8 text-gray-300" />}
            text="Nothing urgent right now. Nice work." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {queue.slice(0, 5).map((q, i) => <ActionCard key={q.lead.id + i} item={q} onClick={() => setOpenLead(q.lead)} />)}
          </div>
        )}
      </ProSection>

      {/* ── Zone 2: Next 10 Days (Pro) ───────────────────────────────── */}
      <ProSection
        isPro={isPro}
        icon={<Calendar className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
        title="Next 10 Days"
        subtitle={isPro && appts ? `${appts.reduce((a, d) => a + d.appts.length, 0)} scheduled · $${formatCompact(appts.reduce((a, d) => a + d.totalValue, 0))} on calendar` : null}
        unlockBlurb="Spot the day your team is double-booked — or empty. Each card shows appointments + $ on the calendar."
      >
        <CalendarStrip days={appts} onDayClick={setOpenDay} />
      </ProSection>

      {/* ── Zone 3: Open Pipeline (FREE) ─────────────────────────────── */}
      {/* The kanban is unlocked on every tier — that's the basic experience
          and the on-ramp to the Pro features above and below. */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-gray-700" />
            <h2 className="text-base font-bold text-gray-900">Open Pipeline</h2>
            <span className="text-[11px] text-gray-500">
              {totals.openCount} open · <span className="font-semibold text-gray-700">${formatCompact(totals.openValue)}</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {STAGE_COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              col={col}
              leads={byStage[col.id]}
              total={totals.byStage[col.id]}
              onCardClick={setOpenLead}
            />
          ))}
        </div>

        <AgingLegend />
      </section>

      {/* ── Zone 4: Closed summary (Pro) ─────────────────────────────── */}
      <ProSection
        isPro={isPro}
        icon={<Archive className="w-4 h-4 text-gray-500" />}
        title="Closed — Not Interested & Lost"
        subtitle={isPro && closed
          ? `${closed.notInterested} not interested · ${closed.lost} lost · last 30 days`
          : null}
        unlockBlurb="See why deals are falling through. Top loss reasons surfaced so you can spot pricing pressure, ghosting, or weak follow-up."
      >
        {closed && (
          <button
            onClick={() => setClosedExpanded((v) => !v)}
            className="w-full bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-800">
                {closed.total} closed in the last 30 days
              </p>
              {closed.topReasons.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Top reasons: {closed.topReasons.map((r) => `${humanReason(r.reason)} (${r.count})`).join(' · ')}
                </p>
              )}
            </div>
            {closedExpanded
              ? <ChevronDown className="w-4 h-4 text-gray-400" />
              : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>
        )}
        {closedExpanded && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <ClosedTile label="Not Interested" count={closed?.notInterested || 0} color="text-gray-700" />
            <ClosedTile label="Lost"           count={closed?.lost           || 0} color="text-red-600" />
            <ClosedTile label="Stale"          count={closed?.stale          || 0} color="text-amber-600" />
          </div>
        )}
      </ProSection>

      {/* ── Zone 5: Pipeline health (Pro) ────────────────────────────── */}
      <ProSection
        isPro={isPro}
        icon={<TrendingUp className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
        title="Pipeline Health · Last 30 Days"
        unlockBlurb="Track avg time to book, estimate→book conversion, $ at risk, and a weighted forecast for the next 14 days."
      >
        {health && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label="Avg time to book"
              value={health.avgTimeToBookDays != null ? `${health.avgTimeToBookDays.toFixed(1)}` : '—'}
              unit={health.avgTimeToBookDays != null ? 'days' : ''}
            />
            <KpiTile
              label="Estimate → Book"
              value={health.estimateToBookRate != null ? `${health.estimateToBookRate.toFixed(0)}%` : '—'}
            />
            <KpiTile
              label="Pipeline at risk"
              value={`$${formatCompact(health.pipelineAtRisk)}`}
              accent="red"
            />
            <KpiTile
              label="Forecast next 14d"
              value={`$${formatCompact(health.forecast14d)}`}
              hint="weighted by stage"
            />
          </div>
        )}
      </ProSection>

      {/* Day-drill modal — opens when a calendar-strip cell is clicked.
          Lists every appointment on that day with full appointment-time
          + customer + closer + $ details. Each row stacks the LeadDetailModal
          on top so the manager can drill from "what's on Thursday" all the
          way into a single lead's notes/photos in two clicks. Stacks
          below the lead modal in z-order so the lead modal stays visible
          when both are open. */}
      {openDay && (
        <DayDetailModal
          day={openDay}
          onClose={() => setOpenDay(null)}
          onLeadClick={(lead) => setOpenLead(lead)}
        />
      )}

      {/* Drill-down modal — opens when any card is clicked. Renders
          outside the section grid so its overlay covers the whole tab.
          Closes on backdrop click or X; updates patch the local leads
          array so the kanban refreshes without a full network round-trip. */}
      {openLead && (
        <LeadDetailModal
          lead={openLead}
          onClose={() => setOpenLead(null)}
          onUpdate={handleLeadUpdate}
        />
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

/**
 * Wraps a section so Pro-only content collapses to a locked teaser for
 * basic-tier orgs. The teaser keeps the section header visible (so basic
 * users know what they're missing) but swaps the body for an upgrade CTA.
 */
function ProSection({ isPro, icon, title, subtitle, badge, unlockBlurb, children }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3 px-0">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="text-base font-bold text-gray-900 truncate">{title}</h2>
          {badge != null && (
            <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{badge}</span>
          )}
          {subtitle && (
            <span className="text-[11px] text-gray-500 truncate hidden md:inline">{subtitle}</span>
          )}
        </div>
        {!isPro && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Lock className="w-3 h-3" /> Pro
          </span>
        )}
      </div>
      {isPro ? children : <LockedTeaser blurb={unlockBlurb} />}
    </section>
  )
}

function LockedTeaser({ blurb }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-amber-300 p-5 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-amber-50 grid place-items-center shrink-0">
        <Lock className="w-4 h-4 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">Upgrade to Pro to unlock this section</p>
        <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">{blurb}</p>
      </div>
      <a
        href="/settings"
        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white shrink-0"
        style={{ background: BRAND_BLUE }}
      >
        Upgrade
      </a>
    </div>
  )
}

function ActionCard({ item, onClick }) {
  const { reason, urgency, lead } = item
  const borderColor = urgency === 'red' ? 'border-l-red-500' : 'border-l-amber-500'
  const dotColor    = urgency === 'red' ? 'bg-red-500'       : 'bg-amber-500'
  const tagColor    = urgency === 'red' ? 'text-red-600'     : 'text-amber-700'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-white rounded-2xl border-l-4 ${borderColor} border-y border-r border-gray-200 p-3.5 shadow-sm w-full text-left hover:shadow-md active:scale-[0.99] transition-all`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wide ${tagColor}`}>{reason}</span>
      </div>
      <p className="font-bold text-sm text-gray-900 truncate">{lead.contact_name || '—'}</p>
      <p className="text-[11px] text-gray-500 truncate mt-0.5">
        {lead.address || '—'}{Array.isArray(lead.service_types) && lead.service_types.length > 0 ? ` · ${lead.service_types[0]}` : ''}
      </p>
      <div className="mt-2.5 flex items-end justify-between">
        <span className="text-[11px] text-gray-600 truncate">
          {lead.closer?.full_name ? `Closer: ${lead.closer.full_name}` : lead.setter?.full_name ? `From ${lead.setter.full_name}` : '—'}
        </span>
        {lead.estimated_value > 0 && (
          <span className="text-base font-extrabold text-gray-900 shrink-0">
            ${formatCompact(lead.estimated_value)}
          </span>
        )}
      </div>
    </button>
  )
}

function CalendarStrip({ days, onDayClick }) {
  if (!days || days.length === 0) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-sm overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {days.map((d) => <DayCell key={d.date.toISOString()} day={d} onClick={() => onDayClick?.(d)} />)}
      </div>
    </div>
  )
}

function DayCell({ day, onClick }) {
  const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6
  const today = isToday(day.date)
  const hasAppts = day.appts.length > 0
  const wrap  = today
    ? 'border-2 border-blue-600 bg-blue-50'
    : isWeekend
      ? 'border border-gray-200 bg-gray-50'
      : 'border border-gray-200 bg-white'
  // Empty days aren't clickable — nothing to drill into. Days with at
  // least one appointment become buttons. The "+N more" affordance lives
  // inside the same button surface so any tap on the cell drills in.
  const interactive = hasAppts
    ? 'hover:border-blue-400 hover:shadow active:scale-[0.99] cursor-pointer transition-all'
    : 'cursor-default'
  return (
    <button
      type="button"
      onClick={hasAppts ? onClick : undefined}
      disabled={!hasAppts}
      className={`w-[124px] rounded-xl ${wrap} ${interactive} p-2.5 flex flex-col gap-1.5 text-left`}>
      <div className={`text-[10px] font-bold uppercase tracking-wider ${today ? 'text-blue-700' : 'text-gray-400'}`}>
        {today ? 'Today' : format(day.date, 'EEE')}
      </div>
      <div className={`text-lg font-extrabold leading-none ${today ? 'text-blue-900' : 'text-gray-700'}`}>
        {format(day.date, 'EEE d')}
      </div>
      <div className="text-[10px] font-semibold text-gray-500 mt-1">
        {day.appts.length} appt{day.appts.length === 1 ? '' : 's'}
      </div>
      <div className={`text-[13px] font-extrabold ${day.totalValue > 0 ? (today ? 'text-blue-900' : 'text-gray-800') : 'text-gray-300'}`}>
        {day.totalValue > 0 ? `$${formatCompact(day.totalValue)}` : '—'}
      </div>
      {day.appts.slice(0, 3).map((a) => (
        <div
          key={a.id}
          className={`text-[10px] rounded px-1.5 py-0.5 truncate ${today ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          title={`${a.contact_name || ''} — ${a.estimated_value ? `$${formatCompact(a.estimated_value)}` : ''}`}
        >
          {format(new Date(a.appointment_at), 'h:mma')} {(a.contact_name || '').split(' ')[0] || '—'}
          {a.estimated_value > 0 && ` $${formatCompact(a.estimated_value)}`}
        </div>
      ))}
      {day.appts.length > 3 && (
        <div className="text-[10px] text-gray-500">+{day.appts.length - 3} more</div>
      )}
    </button>
  )
}

/**
 * DayDetailModal — drill-down for a single day in the calendar strip.
 *
 * Renders the full appointment list for the selected day, sorted
 * chronologically by appointment_at. Clicking any row stacks the
 * LeadDetailModal on top so the manager can go from "what's on
 * Thursday?" to "Rick Stevens' notes" in two taps.
 *
 * Kept self-contained (no data fetch, no helpers) since the parent
 * already has the day's appts in memory from getUpcomingAppointments.
 */
function DayDetailModal({ day, onClose, onLeadClick }) {
  const today = isToday(day.date)
  const heading = today ? 'Today' : format(day.date, 'EEEE')
  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-xl md:rounded-2xl rounded-t-3xl shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between z-10">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
              {heading}
            </p>
            <h2 className="text-lg font-bold text-gray-900">
              {format(day.date, 'EEEE, MMM d')}
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {day.appts.length} appointment{day.appts.length === 1 ? '' : 's'} ·{' '}
              <span className="font-semibold text-gray-700">${formatCompact(day.totalValue)}</span> on calendar
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 shrink-0"
            aria-label="Close"
          >
            <span className="text-xl text-gray-600">×</span>
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          {day.appts.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">No appointments scheduled.</p>
          ) : (
            day.appts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onLeadClick(a)}
                className="w-full text-left bg-white border border-gray-200 rounded-xl px-3.5 py-3 hover:border-blue-400 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="text-center shrink-0 w-14">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-purple-600">
                      {format(new Date(a.appointment_at), 'h:mm')}
                    </p>
                    <p className="text-[10px] font-bold text-purple-700">
                      {format(new Date(a.appointment_at), 'a')}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">
                      {a.contact_name || '—'}
                    </p>
                    {a.address && (
                      <p className="text-[11px] text-gray-500 truncate flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 shrink-0" />
                        {a.address}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                      {a.closer?.full_name
                        ? `Closer: ${a.closer.full_name}`
                        : a.setter?.full_name
                          ? `Setter: ${a.setter.full_name}`
                          : 'Unassigned'}
                    </p>
                  </div>
                  {a.estimated_value > 0 && (
                    <span className="text-sm font-extrabold text-gray-900 shrink-0">
                      ${formatCompact(a.estimated_value)}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function KanbanColumn({ col, leads, total, onCardClick }) {
  return (
    <div className={`${col.bg} rounded-2xl p-3 min-h-[400px]`}>
      <div className="flex items-center gap-1.5 mb-1 px-1">
        <span className={`w-2 h-2 rounded-full ${col.dot}`} />
        <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">{col.title}</p>
      </div>
      <p className="text-[10px] text-gray-500 px-1 mb-2 leading-snug">{col.desc}</p>
      <div className="flex items-baseline justify-between mb-3 px-1">
        <span className="text-xl font-extrabold text-gray-900">{total.count}</span>
        <span className="text-xs font-bold text-gray-500">${formatCompact(total.value)}</span>
      </div>
      <div className="space-y-2.5">
        {leads.length === 0 ? (
          <div className="text-center py-6 text-[11px] text-gray-400">Empty</div>
        ) : (
          leads.slice(0, 8).map((l) => <LeadCard key={l.id} lead={l} stage={col.id} onClick={() => onCardClick?.(l)} />)
        )}
        {leads.length > 8 && (
          <p className="text-center text-[11px] font-semibold text-gray-500 py-1">
            + {leads.length - 8} more
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * One card per lead inside a kanban column. Compact by design — manager
 * drills into the full lead by clicking through; the card itself shows
 * only the at-a-glance signals needed to scan a column.
 */
function LeadCard({ lead, stage, onClick }) {
  const aging = computeAging(lead, stage)
  const dotClass = aging.color === 'red'   ? 'bg-red-500'
                 : aging.color === 'amber' ? 'bg-amber-500'
                 :                           'bg-green-500'
  const isUnassignedAppt = stage === 'appt_scheduled' && !lead.closer_id
    && new Date(lead.created_at) < startOfTodayLocal()
  const borderClass = isUnassignedAppt ? 'border-2 border-red-300' : 'border border-gray-200'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`bg-white rounded-xl ${borderClass} p-2.5 shadow-sm w-full text-left hover:border-blue-400 hover:shadow active:scale-[0.99] transition-all`}>
      <div className="flex items-start gap-2 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass} mt-1.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-bold text-gray-900 truncate">{lead.contact_name || '—'}</p>
            {lead.follow_up && (
              <span className="text-[9px] bg-amber-100 text-amber-700 font-bold px-1 rounded">🏴</span>
            )}
          </div>
          {stage === 'appt_scheduled' && lead.appointment_at ? (
            <p className="text-[10px] text-purple-700 font-semibold truncate">
              {format(new Date(lead.appointment_at), 'EEE MMM d · h:mma')}
            </p>
          ) : (
            <p className="text-[10px] text-gray-500 truncate">{lead.address || '—'}</p>
          )}
        </div>
        {lead.estimated_value > 0 && (
          <span className="text-sm font-extrabold text-gray-900 shrink-0">
            ${formatCompact(lead.estimated_value)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        {Array.isArray(lead.service_types) && lead.service_types[0] && (
          <span className="text-[9px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded truncate">
            {lead.service_types[0]}
          </span>
        )}
        <span className={`text-[10px] ${aging.color === 'red' ? 'text-red-600 font-semibold' : 'text-gray-500'} ml-auto truncate`}>
          {stage === 'appt_scheduled' && lead.closer?.full_name
            ? `Closer: ${lead.closer.full_name}`
            : isUnassignedAppt
              ? 'Unassigned ⚠'
              : `${(lead.setter?.full_name || '—').split(' ')[0]} · ${aging.label}`}
        </span>
      </div>
    </button>
  )
}

function AgingLegend() {
  return (
    <div className="flex items-center gap-4 mt-3 px-1 text-[11px] text-gray-500 flex-wrap">
      <span className="font-semibold uppercase tracking-wide">Aging:</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Fresh &lt;3d</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Warming 3–7d</span>
      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Stale &gt;7d</span>
      <span className="text-gray-400">·</span>
      <span className="flex items-center gap-1">🏴 Follow-up flag</span>
      <span className="text-gray-400">·</span>
      <span className="flex items-center gap-1 text-red-600 font-semibold">⚠ Appt unassigned from previous day</span>
    </div>
  )
}

function EmptyTile({ icon, text }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-6 flex flex-col items-center text-center">
      {icon}
      <p className="text-sm font-semibold text-gray-700 mt-2">{text}</p>
    </div>
  )
}

function ClosedTile({ label, count, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${color}`}>{count}</p>
    </div>
  )
}

function KpiTile({ label, value, unit, hint, accent }) {
  const valueColor = accent === 'red' ? 'text-red-600' : 'text-gray-900'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 ${valueColor}`}>
        {value}
        {unit && <span className="text-sm font-bold text-gray-500"> {unit}</span>}
      </p>
      {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  )
}

/* ── Pure helpers ───────────────────────────────────────────────────────── */

function computeAging(lead, stage) {
  // Pick the right anchor per stage so "days in stage" is meaningful:
  //   hot_lead       → hot_lead_started_at (when interest was first logged)
  //   estimate_sent  → estimate_sent_at    (when the quote went out)
  //   appt_scheduled → created_at          (deal age, not appt-date)
  //   booked         → created_at
  const anchor = stage === 'hot_lead'      ? (lead.hot_lead_started_at || lead.created_at)
              :  stage === 'estimate_sent' ? (lead.estimate_sent_at    || lead.created_at)
              :                              lead.created_at
  const days = Math.floor((Date.now() - new Date(anchor).getTime()) / 86_400_000)
  let color = 'green'
  if (days >= 7)      color = 'red'
  else if (days >= 3) color = 'amber'
  const label = days === 0 ? 'today' : `${days}d`
  return { days, color, label }
}

function startOfTodayLocal() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function formatCompact(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >=     1_000) return `${(v / 1_000).toFixed(v < 10_000 ? 1 : 0)}k`
  return v.toFixed(0)
}

// Map enum lost_reason → display label. Mirrors the picker copy in
// InteractionModal + CloserHome so closed-summary chips read the same way.
function humanReason(r) {
  return ({
    has_provider:       'Already has provider',
    not_decision_maker: 'Not decision-maker',
    not_in_market:      'Not in market',
    hostile:            'Hostile',
    price:              'Price',
    timing:             'Timing',
    competitor:         'Competitor',
    ghosted:            'Ghosted',
    diy:                'DIY',
    other:              'Other',
  })[r] || r
}
