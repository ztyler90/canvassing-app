import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, subDays, startOfDay, endOfDay, startOfWeek, startOfMonth, differenceInCalendarDays } from 'date-fns'
import { Users, DollarSign, Home, TrendingUp, MapPin, BarChart2, LogOut, Map, Plus, Trash2, Edit2, X, Check, Radio, Trophy, Download, Settings, BookOpen, Shield, UserPlus, ChevronRight, AlertTriangle, Search, Crosshair } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getAllSessions, getAllReps, getManagerMapData, signOut,
  getTerritories, createTerritory, updateTerritory, deleteTerritory,
  setTerritoryAssignments, getAllDoorHistory, getDoNotKnockList,
  addDoNotKnock, removeDoNotKnock,
  getActiveRepLocations, getLeaderboardData, getAllBookings,
  getMyOrganization,
} from '../lib/supabase.js'
import { computeConversion } from '../lib/repStats.js'
import { ConversionFunnel } from './RepHome.jsx'
import MapView from '../components/MapView.jsx'
import TerritoryMap from '../components/TerritoryMap.jsx'
import {
  RichStatCard, MiniSparkArea, MiniSparkBars, RadialGauge,
  formatCompact, computeTrend, groupSessionsByDay,
} from '../components/StatSparkCards.jsx'

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue
const BRAND_LIME  = '#7DC31E'  // KnockIQ lime (accent)
const TERRITORY_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#10B981', '#EF4444', '#0EA5E9', '#14B8A6']

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: BarChart2 },
  { id: 'reps',        label: 'Reps',        icon: Users     },
  { id: 'bookings',    label: 'Bookings',    icon: BookOpen  },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy    },
  { id: 'live',        label: 'Live',        icon: Radio     },
  { id: 'map',         label: 'Map',         icon: MapPin    },
  { id: 'territories', label: 'Territories', icon: Map       },
]

// Tabs that suppress the date/rep filter bar
const NO_FILTER_TABS = new Set(['territories', 'live', 'leaderboard'])

// Resolve a period keyword to a concrete { dateFrom, dateTo } ISO pair.
// "today" / "week" (Mon-start) / "month" are calendar-bounded — so at 9am
// Wednesday "this week" covers Mon 0:00 → now, and "this month" covers
// the 1st → now. "all" floors to the epoch so downstream queries don't
// need a special-case null check.
function resolvePeriod(range) {
  const now    = new Date()
  const dateTo = endOfDay(now).toISOString()
  if (range === 'today') return { dateFrom: startOfDay(now).toISOString(), dateTo }
  if (range === 'week')  return { dateFrom: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), dateTo }
  if (range === 'month') return { dateFrom: startOfMonth(now).toISOString(), dateTo }
  if (range === 'all')   return { dateFrom: new Date(0).toISOString(), dateTo }
  return { dateFrom: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), dateTo }
}

// Pretty label for the banner on the Overview page.
function periodLabel(range) {
  if (range === 'today') return 'Today'
  if (range === 'week')  return 'This week'
  if (range === 'month') return 'This month'
  if (range === 'all')   return 'All time'
  return ''
}

export default function ManagerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab]               = useState('overview')
  const [sessions, setSessions]     = useState([])
  const [reps, setReps]             = useState([])
  const [mapData, setMapData]       = useState([])
  const [bookings, setBookings]     = useState([])
  const [org, setOrg]               = useState(null)
  const [loading, setLoading]       = useState(true)
  const [dateRange, setDateRange]   = useState('week')
  const [selectedRep, setSelectedRep] = useState('all')

  useEffect(() => { loadData() }, [dateRange, selectedRep])

  async function loadData() {
    setLoading(true)
    // Calendar-period semantics: today / this week (Mon-start) / this month
    // / all time. "All time" uses the epoch as a lower bound so downstream
    // queries don't need a special code path.
    const { dateFrom, dateTo } = resolvePeriod(dateRange)
    const filters  = { dateFrom, dateTo, ...(selectedRep !== 'all' ? { repId: selectedRep } : {}) }

    const [sess, repList, interactions, bkgs, myOrg] = await Promise.all([
      getAllSessions(filters),
      getAllReps(),
      getManagerMapData(filters),
      // Fetch both booked and unbooked (estimate_requested) rows so the
      // Bookings tab's sub-nav can switch between them without re-fetching.
      getAllBookings({ ...filters, outcome: 'all' }),
      getMyOrganization(),
    ])
    setSessions(sess)
    setReps(repList)
    setMapData(interactions)
    setBookings(bkgs)
    setOrg(myOrg)
    setLoading(false)
  }

  const totalRevenue       = sessions.reduce((s, x) => s + (x.revenue_booked || 0), 0)
  const totalDoors         = sessions.reduce((s, x) => s + (x.doors_knocked || 0), 0)
  const totalBookings      = sessions.reduce((s, x) => s + (x.bookings || 0), 0)
  // A booking is always an estimate too — mirrors computePeriodStats so a
  // historical session where raw estimates < bookings doesn't show a broken
  // funnel (estimates smaller than bookings).
  const totalEstimates     = sessions.reduce(
    (s, x) => s + Math.max(x.estimates || 0, x.bookings || 0), 0)
  const totalConversations = sessions.reduce((s, x) => s + (x.conversations || 0), 0)
  const closeRate          = totalDoors > 0 ? ((totalBookings / totalDoors) * 100).toFixed(1) : '0'
  const revenuePerDoor     = totalDoors > 0 ? (totalRevenue / totalDoors).toFixed(2) : '0'

  // Org-configured terminology flows into the funnel so the Estimates row
  // re-labels to "Appointments" for teams that prefer that verbiage.
  const countLabel     = org?.count_goal_label === 'appointments' ? 'Appointments' : 'Estimates'

  const repMap = {}
  sessions.forEach((s) => {
    const repName = s.users?.full_name || s.rep_id
    if (!repMap[s.rep_id]) {
      repMap[s.rep_id] = { id: s.rep_id, name: repName, sessions: 0, doors: 0, bookings: 0, revenue: 0, estimates: 0 }
    }
    const r = repMap[s.rep_id]
    r.sessions++; r.doors += s.doors_knocked || 0; r.bookings += s.bookings || 0
    r.revenue += s.revenue_booked || 0; r.estimates += s.estimates || 0
  })
  const repStats = Object.values(repMap).sort((a, b) => b.revenue - a.revenue)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-4" style={{ backgroundColor: BRAND_GREEN }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-blue-200 text-sm">Owner View</p>
              {user?.organization?.name && (
                <span className="text-blue-200/80 text-xs">· {user.organization.name}</span>
              )}
            </div>
            <div className="flex items-baseline gap-0.5 mt-0.5">
              <span className="text-white text-xl font-extrabold">Knock</span>
              <span className="text-xl font-extrabold" style={{ color: BRAND_LIME }}>IQ</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {user?.is_super_admin && (
              <button
                onClick={() => navigate('/super-admin')}
                title="Super-Admin Dashboard"
                className="p-2 rounded-full bg-white/20 ring-1 ring-white/40">
                <Shield className="w-5 h-5 text-white" />
              </button>
            )}
            <button onClick={() => navigate('/settings')} className="p-2 rounded-full bg-white/20">
              <Settings className="w-5 h-5 text-white" />
            </button>
            <button onClick={signOut} className="p-2 rounded-full bg-white/20">
              <LogOut className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        {!NO_FILTER_TABS.has(tab) && (
          <div className="flex gap-2">
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}
              className="flex-1 bg-white/20 text-white text-sm rounded-xl px-3 py-2 border border-white/30 focus:outline-none">
              <option value="today" className="text-gray-900">Today</option>
              <option value="week"  className="text-gray-900">This week</option>
              <option value="month" className="text-gray-900">This month</option>
              <option value="all"   className="text-gray-900">All time</option>
            </select>
            <select value={selectedRep} onChange={(e) => setSelectedRep(e.target.value)}
              className="flex-1 bg-white/20 text-white text-sm rounded-xl px-3 py-2 border border-white/30 focus:outline-none">
              <option value="all" className="text-gray-900">All Reps</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id} className="text-gray-900">{r.full_name || r.email}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Trial banner */}
      {user?.organization?.status === 'trial' && user?.organization?.trial_ends_at && (() => {
        const msLeft = new Date(user.organization.trial_ends_at).getTime() - Date.now()
        const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)))
        const isExpired = msLeft <= 0
        return (
          <div className={`px-4 py-2 text-center text-sm font-medium ${isExpired ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
            {isExpired
              ? 'Your free trial has ended. Upgrade to keep using KnockIQ.'
              : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your free trial.`}
          </div>
        )
      })()}

      {/* Tab Bar — horizontally scrollable for 7 tabs. A right-edge fade
          + pulsing chevron signals to the manager that more tabs (Map,
          Territories) live past the fold. The hint fades away once they
          scroll within ~12px of the end. */}
      <TabBar tabs={TABS} current={tab} onChange={setTab} />

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${!NO_FILTER_TABS.has(tab) ? 'px-4 py-5 space-y-4 pb-8' : ''}`}>
        {!NO_FILTER_TABS.has(tab) && loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 rounded-full"
              style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab sessions={sessions} totalRevenue={totalRevenue} totalDoors={totalDoors}
                totalBookings={totalBookings} totalEstimates={totalEstimates}
                totalConversations={totalConversations}
                closeRate={closeRate} revenuePerDoor={revenuePerDoor}
                countLabel={countLabel}
                repStats={repStats}
                dateRange={dateRange} />
            )}
            {tab === 'live'        && <LiveTab allReps={reps} />}
            {tab === 'leaderboard' && <LeaderboardTab />}
            {tab === 'reps'        && <RepsTab repStats={repStats} allReps={reps} />}
            {tab === 'bookings'    && <BookingsTab bookings={bookings} />}
            {tab === 'map'         && <MapTab interactions={mapData} />}
            {tab === 'territories' && <TerritoryTab allReps={reps} managerId={user?.id} />}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({
  sessions, totalRevenue, totalDoors, totalBookings, totalEstimates,
  totalConversations = 0, closeRate, revenuePerDoor, countLabel = 'Estimates',
  repStats = [], dateRange = '7',
}) {
  const navigate = useNavigate()
  const totalHours     = sessions.reduce((sum, s) => {
    if (!s.started_at || !s.ended_at) return sum
    return sum + (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
  }, 0)
  const revenuePerHour = totalHours > 0 ? (totalRevenue / totalHours).toFixed(0) : '—'

  // ── Daily series for sparklines + the Daily Revenue bar chart ─────────
  // Group sessions into one bucket per calendar day across the selected
  // date range (zero-fill empty days so the sparkline has a stable length).
  // A "day" is bucketed by session.started_at local midnight.
  // The visible window length comes from the calendar-period filter:
  //   today  → 1 day
  //   week   → days-since-Monday + 1
  //   month  → today's day-of-month
  //   all    → derived from oldest session; capped at 30 so bars stay legible.
  const days = daysForRange(dateRange, sessions)
  const daily = groupSessionsByDay(sessions, days)

  // Trend chips compare the last half of the window to the first half.
  // Honest, no extra DB call — if the back half outpaces the front, ▲.
  const revenueTrend  = computeTrend(daily, 'revenue')
  const doorsTrend    = computeTrend(daily, 'doors')
  const bookingsTrend = computeTrend(daily, 'bookings')

  // Close Rate goal: hard-coded at 5% for now. Future: pull from org settings.
  const goalCloseRate = 5.0
  const closeNum      = parseFloat(closeRate) || 0
  const gaugePct      = Math.min(closeNum / goalCloseRate, 1) * 100

  // Feed the rep-side ConversionFunnel component with team-aggregated totals.
  // The shape matches { doors, conversations, estimates, bookings, ... } so
  // both computeConversion and ConversionFunnel render identically to rep view.
  const teamStats = {
    doors:         totalDoors,
    conversations: totalConversations,
    estimates:     totalEstimates,
    bookings:      totalBookings,
    revenue:       totalRevenue,
  }
  const teamConv = computeConversion(teamStats)

  function exportCSV() {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

    // ── Section 1: Summary ──────────────────────────────────────────
    const summary = [
      ['SUMMARY'],
      ['Revenue Booked', `$${totalRevenue.toFixed(2)}`],
      ['Doors Knocked', totalDoors],
      ['Jobs Booked', totalBookings],
      ['Estimates Requested', totalEstimates],
      ['Close Rate', `${closeRate}%`],
      ['Revenue / Door', `$${revenuePerDoor}`],
      ['Revenue / Hour', revenuePerHour !== '—' ? `$${revenuePerHour}` : '—'],
      ['Total Sessions', sessions.length],
      ['Total Hours Canvassing', `${totalHours.toFixed(1)}`],
      [],
    ]

    // ── Section 2: Per-Rep Breakdown ────────────────────────────────
    const repMap = {}
    sessions.forEach((s) => {
      const key = s.rep_id
      if (!repMap[key]) repMap[key] = { name: s.users?.full_name || s.rep_id, sessions: 0, doors: 0, bookings: 0, estimates: 0, revenue: 0, hours: 0 }
      const r = repMap[key]
      r.sessions++
      r.doors     += s.doors_knocked  || 0
      r.bookings  += s.bookings       || 0
      r.estimates += s.estimates      || 0
      r.revenue   += s.revenue_booked || 0
      if (s.started_at && s.ended_at)
        r.hours += (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
    })
    const repRows = [
      ['REP BREAKDOWN'],
      ['Name', 'Sessions', 'Doors', 'Bookings', 'Estimates', 'Close %', 'Revenue', 'Hours'],
      ...Object.values(repMap).sort((a, b) => b.revenue - a.revenue).map((r) => {
        const cr = r.doors > 0 ? ((r.bookings / r.doors) * 100).toFixed(1) : '0'
        return [esc(r.name), r.sessions, r.doors, r.bookings, r.estimates, `${cr}%`, `$${r.revenue.toFixed(2)}`, r.hours.toFixed(1)]
      }),
      [],
    ]

    // ── Section 3: Session Log ───────────────────────────────────────
    const sessionRows = [
      ['SESSION LOG'],
      ['Rep', 'Date', 'Start Time', 'End Time', 'Doors', 'Bookings', 'Estimates', 'Revenue', 'Hours'],
      ...sessions.map((s) => {
        const start = s.started_at ? new Date(s.started_at) : null
        const end   = s.ended_at   ? new Date(s.ended_at)   : null
        const hrs   = start && end ? ((end - start) / 3600000).toFixed(1) : ''
        return [
          esc(s.users?.full_name || s.rep_id),
          start ? format(start, 'yyyy-MM-dd') : '',
          start ? format(start, 'h:mm a') : '',
          end   ? format(end,   'h:mm a') : '',
          s.doors_knocked  || 0,
          s.bookings       || 0,
          s.estimates      || 0,
          `$${(s.revenue_booked || 0).toFixed(2)}`,
          hrs,
        ]
      }),
    ]

    const allRows = [...summary, ...repRows, ...sessionRows]
    const csv     = allRows.map((row) => row.join(',')).join('\r\n')
    const blob    = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url     = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href        = url
    a.download    = `canvassing-overview-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openInSheets() {
    // Build CSV and encode it, then open Google Sheets import flow
    // Easiest reliable path: download CSV first, then link to sheets.new
    exportCSV()
    setTimeout(() => window.open('https://sheets.new', '_blank'), 600)
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Period banner ───────────────────────────────────────────────
         Echoes the header's date-range selection right on the overview
         so there's never any doubt about the window the numbers cover.
         (The actual selector lives in the header bar above.) */}
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team overview</p>
          <p className="text-sm text-slate-600">
            {periodLabel(dateRange)}{repStats.length > 0 ? ` · ${repStats.length} rep${repStats.length === 1 ? '' : 's'} active` : ''}
          </p>
        </div>
      </div>

      {/* ── KPI cards — 2×2 on mobile, 4-across on desktop ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <RichStatCard
          label="Revenue Booked"
          value={`$${formatCompact(totalRevenue)}`}
          trend={revenueTrend}
          icon={<DollarSign className="w-4 h-4" />}
          gradient="from-lime-100 via-lime-50 to-white"
          border="border-lime-200/60"
          iconColor="text-lime-700"
        >
          <MiniSparkArea values={daily.map((d) => d.revenue)} color="#5ea636" fill="#7ac94373" />
        </RichStatCard>

        <RichStatCard
          label="Doors Knocked"
          value={totalDoors.toLocaleString()}
          trend={doorsTrend}
          icon={<Home className="w-4 h-4" />}
          gradient="from-blue-100 via-blue-50 to-white"
          border="border-blue-200/60"
          iconColor="text-blue-700"
        >
          <MiniSparkBars values={daily.map((d) => d.doors)} color="#2757d7" highlight="#1e44b0" />
        </RichStatCard>

        <RichStatCard
          label="Jobs Booked"
          value={totalBookings.toLocaleString()}
          trend={bookingsTrend}
          icon={<TrendingUp className="w-4 h-4" />}
          gradient="from-teal-100 via-teal-50 to-white"
          border="border-teal-200/60"
          iconColor="text-teal-700"
        >
          <MiniSparkArea values={daily.map((d) => d.bookings)} color="#0d9488" fill="#14b8a673" />
        </RichStatCard>

        <RichStatCard
          label="Close Rate"
          value={`${closeRate}%`}
          trend={null}
          icon={<BarChart2 className="w-4 h-4" />}
          gradient="from-violet-100 via-violet-50 to-white"
          border="border-violet-200/60"
          iconColor="text-violet-700"
        >
          <div className="flex items-center gap-3 mt-1">
            <RadialGauge pct={gaugePct} />
            <div>
              <p className="text-[10px] text-gray-500">Goal {goalCloseRate.toFixed(1)}%</p>
            </div>
          </div>
        </RichStatCard>
      </div>

      {/* ── Daily Revenue + Rep Leaderboard (2-col on desktop) ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <DailyRevenueChart daily={daily} />
        <RepLeaderboard repStats={repStats} />
      </div>

      {/* ── Conversion Funnel + Performance Metrics (2-col on desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Team Conversion Funnel — same visualization reps see on their home
           page, but aggregated across all filtered sessions. Lets a manager
           spot where the team is leaking at a glance (Doors → Convos →
           Estimates/Appointments → Bookings). */}
        <ConversionFunnel
          stats={teamStats}
          conv={teamConv}
          estimateLabel={countLabel}
        />
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b">
            <p className="font-semibold text-gray-700 text-sm">Performance Metrics</p>
          </div>
          {[
            ['Revenue / Hour',         `$${revenuePerHour}`],
            ['Revenue / Door',         `$${revenuePerDoor}`],
            ['Estimates Requested',    totalEstimates],
            ['Sessions',               sessions.length],
            ['Total Hours Canvassing', `${totalHours.toFixed(1)} hrs`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between px-5 py-2.5 border-b last:border-0">
              <span className="text-sm text-gray-600">{label}</span>
              <span className="text-sm font-bold text-gray-900">{value}</span>
            </div>
          ))}
        </div>
      </div>
      {sessions.length > 0 && (
        <div>
          <p className="font-semibold text-gray-700 text-sm mb-2">Recent Sessions</p>
          <div className="space-y-2">
            {sessions.slice(0, 10).map((s) => (
              <button
                key={s.id}
                onClick={() => navigate('/session/' + s.id)}
                className="w-full bg-white rounded-xl px-4 py-3 border border-gray-100 text-left active:bg-gray-50 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{s.users?.full_name || 'Rep'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(s.started_at), 'EEE MMM d, h:mm a')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-bold text-gray-900">${(s.revenue_booked || 0).toFixed(0)}</p>
                      <p className="text-xs text-gray-400">{s.doors_knocked || 0} doors</p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {sessions.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No sessions in this period</p>
          <p className="text-sm mt-1">Try expanding the date range.</p>
        </div>
      )}
      {/* Export buttons — compact, bottom of page */}
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={exportCSV} title="Export CSV"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
          style={{ backgroundColor: BRAND_GREEN }}>
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
        <button onClick={openInSheets} title="Open in Google Sheets"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 bg-white">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="2" fill="#34A853" opacity=".15"/>
            <path d="M3 9h18M3 15h18M9 3v18" stroke="#34A853" strokeWidth="1.5"/>
          </svg>
          Sheets
        </button>
      </div>
    </div>
  )
}

// ─── Bookings Tab ─────────────────────────────────────────────────────────────
// Receives a merged list of interactions where outcome ∈ {booked, estimate_requested}
// and lets the manager toggle between the two sub-views. Each card renders a
// matching status pill + accent so the two lists read differently at a glance.
function BookingsTab({ bookings }) {
  const [view, setView] = useState('booked') // 'booked' | 'estimate_requested'

  const bookedList    = bookings.filter((b) => b.outcome === 'booked')
  const estimateList  = bookings.filter((b) => b.outcome === 'estimate_requested')
  const list          = view === 'booked' ? bookedList : estimateList

  const SubNavButton = ({ id, label, count }) => {
    const active = view === id
    return (
      <button
        onClick={() => setView(id)}
        className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${active ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
        style={active ? { backgroundColor: BRAND_GREEN } : {}}
      >
        <span>{label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${active ? 'bg-white/25 text-white' : 'bg-white text-gray-500'}`}>
          {count}
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-3">
      {/* Sub-nav */}
      <div className="flex gap-2 bg-white rounded-xl p-1.5 border border-gray-200">
        <SubNavButton id="booked"             label="Booked"   count={bookedList.length}   />
        <SubNavButton id="estimate_requested" label="Unbooked Estimates" count={estimateList.length} />
      </div>

      {list.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-sm">
            {view === 'booked' ? 'No bookings in this period' : 'No unbooked estimates in this period'}
          </p>
          <p className="text-xs mt-1">Try expanding the date range.</p>
        </div>
      ) : (
        list.map((b) => {
          const photos    = b.interactions?.photo_urls || []
          const followUp  = b.interactions?.follow_up  || false
          const services  = Array.isArray(b.service_types) ? b.service_types : []
          const createdAt = b.created_at ? new Date(b.created_at) : null
          const isBooked  = b.outcome === 'booked'

          return (
            <div key={b.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isBooked ? (
                      <span className="text-sm font-bold text-green-700">✅ Booked</span>
                    ) : (
                      <span className="text-sm font-bold text-amber-700">📋 Estimate Requested</span>
                    )}
                    {followUp && (
                      <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
                        🏴 Follow Up
                      </span>
                    )}
                  </div>
                  <p className="text-gray-700 text-sm mt-0.5 font-medium truncate">
                    {b.contact_name || '—'}
                  </p>
                  {b.address && (
                    <p className="text-gray-400 text-xs mt-0.5 truncate">{b.address}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {b.estimated_value > 0 && (
                    <p className={`font-bold text-base ${isBooked ? 'text-green-600' : 'text-amber-600'}`}>
                      ${b.estimated_value.toFixed(0)}
                    </p>
                  )}
                  {createdAt && (
                    <p className="text-gray-400 text-xs">{format(createdAt, 'MMM d, h:mm a')}</p>
                  )}
                </div>
              </div>

              {/* Rep + services row */}
              <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
                {b.users?.full_name && (
                  <span className="text-xs bg-blue-50 text-blue-700 font-medium px-2 py-0.5 rounded-full">
                    {b.users.full_name}
                  </span>
                )}
                {b.contact_phone && (
                  <span className="text-xs text-gray-500">📞 {b.contact_phone}</span>
                )}
                {services.map((svc) => (
                  <span key={svc} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {svc}
                  </span>
                ))}
              </div>

              {/* Photo thumbnails */}
              {photos.length > 0 && (
                <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
                  {photos.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={url}
                        alt={`Photo ${i + 1}`}
                        className="w-16 h-16 rounded-xl object-cover border border-gray-200 active:opacity-75"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── Reps Tab ─────────────────────────────────────────────────────────────────
// Shows a perf card for each rep with activity in the selected window, plus a
// dim card for reps on the team who had no sessions in the period (so newly-
// added reps don't disappear until they log their first door). An "Add Rep"
// button at the bottom opens the full Team Management flow in Settings.
function RepsTab({ repStats, allReps = [] }) {
  const navigate = useNavigate()

  // Reps who are on the team but produced no sessions in the current window.
  const activeIds = new Set(repStats.map((r) => r.id))
  const idleReps  = allReps.filter((r) => !activeIds.has(r.id))

  const handleAddRep    = () => navigate('/settings', { state: { openAddRep: true } })
  const handleOpenRep   = (repId) => navigate(`/manager/rep/${repId}`)

  return (
    <div className="space-y-3">
      {/* Active reps with performance stats — tap to drill into full stats */}
      {repStats.map((rep, i) => {
        const cr = rep.doors > 0 ? ((rep.bookings / rep.doors) * 100).toFixed(1) : '0'
        return (
          <button
            key={rep.id}
            onClick={() => handleOpenRep(rep.id)}
            className="w-full text-left bg-white rounded-2xl border border-gray-200 p-4 active:bg-gray-50 hover:border-blue-300 transition-colors"
            aria-label={`Open ${rep.name} details`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: BRAND_GREEN }}>{i + 1}</div>
              <div>
                <p className="font-bold text-gray-900">{rep.name}</p>
                <p className="text-xs text-gray-400">{rep.sessions} sessions</p>
              </div>
              <div className="ml-auto text-right flex items-center gap-1">
                <div>
                  <p className="text-lg font-bold text-gray-900">${rep.revenue.toFixed(0)}</p>
                  <p className="text-xs text-green-600">{rep.bookings} booked</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 ml-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
              <MicroStat label="Doors"     value={rep.doors}       />
              <MicroStat label="Estimates" value={rep.estimates}   />
              <MicroStat label="Close %"   value={`${cr}%`}        />
            </div>
          </button>
        )
      })}

      {/* Empty state if no sessions anywhere in the period */}
      {repStats.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-sm">No rep activity in this period.</p>
          <p className="text-xs mt-1">Try expanding the date range — or add a new rep below.</p>
        </div>
      )}

      {/* Reps on the team with no sessions in the window — keeps them visible. */}
      {idleReps.length > 0 && (
        <div className="pt-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">No activity yet</p>
          <div className="space-y-2">
            {idleReps.map((rep) => (
              <button
                key={rep.id}
                onClick={() => handleOpenRep(rep.id)}
                className="w-full text-left bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3 active:bg-gray-100 hover:border-blue-300 transition-colors"
                aria-label={`Open ${rep.full_name || rep.email} details`}
              >
                <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center">
                  {(rep.full_name || rep.email || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-700 truncate">{rep.full_name || rep.email}</p>
                  <p className="text-xs text-gray-400 truncate">No sessions in this window</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add Rep button — opens Settings team management flow with the form pre-opened */}
      <button
        onClick={handleAddRep}
        className="w-full mt-3 py-3 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 text-sm font-semibold transition-colors hover:bg-blue-50"
        style={{ borderColor: BRAND_GREEN, color: BRAND_GREEN }}>
        <UserPlus className="w-4 h-4" />
        Add Rep
      </button>
    </div>
  )
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────
// Door-status filters live in this tab (not in MapView) because the filter
// is a manager-dashboard UX concern and MapView is shared with the rep's
// live canvassing screen. We just feed MapView a pre-filtered list so it
// stays a dumb renderer.
const MAP_OUTCOMES = [
  { id: 'no_answer',          color: '#9CA3AF', label: 'No Answer' },
  { id: 'not_interested',     color: '#EF4444', label: 'Not Int.'  },
  { id: 'estimate_requested', color: '#F59E0B', label: 'Estimate'  },
  { id: 'booked',             color: '#10B981', label: 'Booked'    },
]

function MapTab({ interactions }) {
  const counts = interactions.reduce((acc, i) => { acc[i.outcome] = (acc[i.outcome] || 0) + 1; return acc }, {})
  const mapRef = useRef(null)

  // Per-outcome visibility toggles. Default: all on. Clicking a chip
  // removes that outcome from the rendered set without refetching.
  const [visible, setVisible] = useState({
    no_answer:          true,
    not_interested:     true,
    estimate_requested: true,
    booked:             true,
  })
  const toggleOutcome = (id) => setVisible((v) => ({ ...v, [id]: !v[id] }))
  const allOn  = MAP_OUTCOMES.every((o) => visible[o.id])
  const allOff = MAP_OUTCOMES.every((o) => !visible[o.id])
  const setAll = (on) => setVisible(Object.fromEntries(MAP_OUTCOMES.map((o) => [o.id, on])))

  const filteredInteractions = interactions.filter((i) => visible[i.outcome])

  // Jump the map to a geocoded address. The tight zoom (17) mirrors the
  // street-level default so managers land looking at individual houses
  // right after searching.
  const handleGoTo = (lat, lng) => mapRef.current?.flyTo(lat, lng, 17)
  const handleRecenter = () => mapRef.current?.fitToInteractions(40, 18)

  return (
    <div className="space-y-3">
      <AddressSearch onResult={handleGoTo} onRecenter={handleRecenter} canRecenter={filteredInteractions.length > 0} />

      {/* Outcome toggle chips — tap to hide/show pins of that color. */}
      <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
            Door Status · tap to toggle
          </p>
          <button
            onClick={() => setAll(!allOn)}
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-700"
          >
            {allOff ? 'Show all' : allOn ? 'Hide all' : 'Show all'}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          {MAP_OUTCOMES.map(({ id, color, label }) => {
            const on    = visible[id]
            const count = counts[id] || 0
            return (
              <button
                key={id}
                onClick={() => toggleOutcome(id)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${on ? 'bg-white border-gray-300 text-gray-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
              >
                <div
                  className="w-3 h-3 rounded-full transition-opacity"
                  style={{ backgroundColor: color, opacity: on ? 1 : 0.3 }}
                />
                <span className={on ? '' : 'line-through'}>{label}</span>
                <span className={`text-[10px] font-bold px-1.5 rounded-full ${on ? 'bg-gray-100 text-gray-500' : 'bg-gray-200 text-gray-400'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden border border-gray-200" style={{ height: '480px' }}>
        <MapView
          ref={mapRef}
          interactions={filteredInteractions}
          className="w-full h-full"
          followUser={false}
          autoFit
        />
      </div>
    </div>
  )
}

// ─── Territory Tab ────────────────────────────────────────────────────────────
function TerritoryTab({ allReps, managerId }) {
  const [territories, setTerritories] = useState([])
  const [doorHistory, setDoorHistory] = useState([])
  const [doNotKnock, setDoNotKnock]   = useState([])
  const [loading, setLoading]         = useState(true)
  const [drawing, setDrawing]         = useState(false)
  // Live count of vertices placed during the current draw session.
  // Drives the enabled state of the "Complete" button.
  const [drawPts, setDrawPts]         = useState(0)

  // Territory create/edit form
  const [showForm, setShowForm]       = useState(false)
  const [editingId, setEditingId]     = useState(null)
  const [newPolygon, setNewPolygon]   = useState(null)
  const [form, setForm]               = useState({ name: '', color: '#3B82F6', category: '', repIds: [] })
  const [saving, setSaving]           = useState(false)
  // Surface save errors (missing org, RLS, network) directly in the form
  // instead of silently closing the modal. Before this, a failed insert
  // would close the sheet and the list would stay empty — looking like a
  // UI bug ("No territories yet after I drew one") when it was actually a
  // silently-dropped error.
  const [saveError, setSaveError]     = useState('')

  // DNK form
  const [showDnkForm, setShowDnkForm] = useState(false)
  const [dnkForm, setDnkForm]         = useState({ address: '', lat: '', lng: '', reason: '' })
  const [dnkSaving, setDnkSaving]     = useState(false)

  const mapRef = useRef(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [terrs, history, dnk] = await Promise.all([
      getTerritories(),
      getAllDoorHistory(),
      getDoNotKnockList(),
    ])
    setTerritories(terrs)
    setDoorHistory(history)
    setDoNotKnock(dnk)
    setLoading(false)
  }

  function startDraw() {
    mapRef.current?.startDrawing()
    setDrawing(true)
    setDrawPts(0)
  }

  function cancelDraw() {
    mapRef.current?.cancelDrawing()
    setDrawing(false)
    setDrawPts(0)
  }

  function completeDraw() {
    // Bridge the "Complete" button click to the map's finishDraw.
    // If the polygon has < 3 points the map itself discards the attempt.
    mapRef.current?.completeDrawing()
  }

  function handlePolygonComplete(coords) {
    setDrawing(false)
    setDrawPts(0)
    setNewPolygon(coords)
    setEditingId(null)
    setForm({ name: '', color: '#3B82F6', category: '', repIds: [] })
    setSaveError('')
    setShowForm(true)
  }

  function openEditForm(territory) {
    setEditingId(territory.id)
    setNewPolygon(null)
    setForm({
      name:     territory.name,
      color:    territory.color || '#3B82F6',
      category: territory.category || '',
      repIds:   (territory.territory_assignments || []).map((a) => a.rep_id),
    })
    setSaveError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      if (editingId) {
        const { error: updErr } = await updateTerritory(editingId, {
          name:     form.name.trim(),
          color:    form.color,
          category: form.category?.trim() || null,
        })
        if (updErr) throw updErr
        await setTerritoryAssignments(editingId, form.repIds, managerId)
      } else {
        const { data, error } = await createTerritory({
          name:       form.name.trim(),
          color:      form.color,
          category:   form.category?.trim() || null,
          polygon:    newPolygon,
          createdBy:  managerId,
        })
        // Previously we discarded `error` and just checked for truthy
        // `data`; when createTerritory's org-scoping failed silently the
        // modal closed and the list stayed empty — the exact "No
        // territories yet" bug. Now we raise it into `saveError` so the
        // manager sees why the save didn't stick.
        if (error || !data) throw (error || new Error('Territory could not be saved.'))
        if (form.repIds.length) {
          await setTerritoryAssignments(data.id, form.repIds, managerId)
        }
      }
      setShowForm(false); setNewPolygon(null); setEditingId(null)
      await loadAll()
    } catch (err) {
      console.warn('[Territory] save failed:', err)
      setSaveError(err?.message || 'Could not save. Please try again.')
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this territory? This cannot be undone.')) return
    await deleteTerritory(id)
    await loadAll()
  }

  async function handleAddDnk() {
    const lat = parseFloat(dnkForm.lat)
    const lng = parseFloat(dnkForm.lng)
    if (!dnkForm.address && (isNaN(lat) || isNaN(lng))) return
    setDnkSaving(true)
    await addDoNotKnock({
      address: dnkForm.address || null,
      lat:     isNaN(lat) ? 0 : lat,
      lng:     isNaN(lng) ? 0 : lng,
      reason:  dnkForm.reason || null,
      addedBy: managerId,
    })
    setDnkForm({ address: '', lat: '', lng: '', reason: '' })
    setShowDnkForm(false); setDnkSaving(false)
    const dnk = await getDoNotKnockList()
    setDoNotKnock(dnk)
  }

  async function handleRemoveDnk(id) {
    await removeDoNotKnock(id)
    setDoNotKnock((prev) => prev.filter((d) => d.id !== id))
  }

  const toggleRep = (repId) => setForm((f) => ({
    ...f,
    repIds: f.repIds.includes(repId) ? f.repIds.filter((r) => r !== repId) : [...f.repIds, repId],
  }))

  if (loading) return (
    <div className="flex justify-center py-24">
      <div className="animate-spin w-8 h-8 rounded-full"
        style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
    </div>
  )

  return (
    <div className="flex flex-col">
      {/* Control bar */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-gray-800 text-sm">
            {territories.length} {territories.length === 1 ? 'territory' : 'territories'}
          </p>
          {!drawing && (
            <button onClick={startDraw}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold"
              style={{ backgroundColor: BRAND_GREEN }}>
              <Plus className="w-3.5 h-3.5" /> Draw Territory
            </button>
          )}
        </div>

        {/* Drawing mode — full-width status row with a big obvious
            "Complete" button. Disabled until 3 points are placed
            (minimum for a valid polygon). Cancel is secondary. */}
        {drawing && (
          <div className="mt-3 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex-shrink-0">
                  {drawPts}
                </span>
                <p className="text-xs text-blue-900 font-semibold truncate">
                  {drawPts === 0
                    ? 'Tap the map to place the first corner'
                    : drawPts < 3
                      ? `Place ${3 - drawPts} more ${3 - drawPts === 1 ? 'corner' : 'corners'} to complete`
                      : 'Ready — tap Complete to finish this zone'}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={cancelDraw}
                className="flex-1 py-2.5 rounded-lg bg-white border border-gray-300 text-gray-600 text-sm font-semibold flex items-center justify-center gap-1"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
              <button
                onClick={completeDraw}
                disabled={drawPts < 3}
                className={`flex-1 py-2.5 rounded-lg text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-opacity ${drawPts < 3 ? 'opacity-50' : ''}`}
                style={{ backgroundColor: BRAND_GREEN }}
              >
                <Check className="w-4 h-4" /> Complete Territory
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Address search — jumps the map to any typed location. Helpful
          for reviewing/drawing territories in a specific neighborhood. */}
      <div className="px-4 py-3 bg-white border-b">
        <AddressSearch
          onResult={(lat, lng) => mapRef.current?.flyTo(lat, lng, 16)}
          onRecenter={() => mapRef.current?.fitToAll(17)}
          canRecenter={territories.length > 0 || doorHistory.length > 0}
        />
      </div>

      {/* Territory Map */}
      <div style={{ height: '380px' }}>
        <TerritoryMap
          ref={mapRef}
          territories={territories}
          doorHistory={doorHistory}
          doNotKnock={doNotKnock}
          onPolygonComplete={handlePolygonComplete}
          onDrawPointsChange={setDrawPts}
          className="w-full h-full"
          autoFit
        />
      </div>

      {/* Legend */}
      <div className="flex gap-3 px-4 py-2 bg-white border-b flex-wrap text-xs">
        <span className="text-gray-400 font-medium">Doors:</span>
        {[['#9CA3AF','No Ans.'],['#EF4444','Not Int.'],['#F59E0B','Estimate'],['#10B981','Booked']].map(([c,l]) => (
          <div key={l} className="flex items-center gap-1 text-gray-500">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />{l}
          </div>
        ))}
        <span className="text-red-500 ml-1">✕ DNK</span>
      </div>

      {/* Territory list + DNK */}
      <div className="px-4 py-3 space-y-2 pb-8">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Zones</p>

        {territories.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <Map className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No territories yet.</p>
            <p className="text-xs mt-1">Click "Draw Territory" and outline a zone on the map.</p>
          </div>
        )}

        {territories.map((t) => {
          const assignedReps = (t.territory_assignments || []).map((a) => a.users?.full_name).filter(Boolean)
          return (
            <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: t.color }} />
                <p className="font-semibold text-gray-900 text-sm flex-1 truncate">{t.name}</p>
                {t.category && (
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${t.color}18`, color: t.color }}
                  >
                    {t.category}
                  </span>
                )}
                <button onClick={() => openEditForm(t)} className="p-1.5 text-gray-400 hover:text-blue-500">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(t.id)} className="p-1.5 text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1 ml-5">
                {assignedReps.length ? `Priority for ${assignedReps.join(', ')}` : 'Visible to everyone'}
              </p>
            </div>
          )
        })}

        {/* DNK Section */}
        <div className="mt-5 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🚫 Do Not Knock</p>
            <button onClick={() => setShowDnkForm((v) => !v)}
              className="text-xs font-semibold text-red-600 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add Entry
            </button>
          </div>

          {showDnkForm && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 space-y-2">
              <input placeholder="Address (e.g. 123 Main St)" value={dnkForm.address}
                onChange={(e) => setDnkForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
              <div className="flex gap-2">
                <input placeholder="Lat" type="number" value={dnkForm.lat}
                  onChange={(e) => setDnkForm((f) => ({ ...f, lat: e.target.value }))}
                  className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
                <input placeholder="Lng" type="number" value={dnkForm.lng}
                  onChange={(e) => setDnkForm((f) => ({ ...f, lng: e.target.value }))}
                  className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
              </div>
              <input placeholder="Reason (optional)" value={dnkForm.reason}
                onChange={(e) => setDnkForm((f) => ({ ...f, reason: e.target.value }))}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none bg-white" />
              <div className="flex gap-2">
                <button onClick={() => setShowDnkForm(false)}
                  className="flex-1 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 font-medium">Cancel</button>
                <button onClick={handleAddDnk} disabled={dnkSaving}
                  className="flex-1 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-60">
                  {dnkSaving ? 'Saving…' : 'Add Entry'}
                </button>
              </div>
            </div>
          )}

          {doNotKnock.length === 0 && !showDnkForm && (
            <p className="text-xs text-gray-400">No entries yet. Addresses added here will show as red ✕ pins on all rep maps.</p>
          )}
          <div className="space-y-1.5">
            {doNotKnock.map((dnk) => (
              <div key={dnk.id} className="flex items-center gap-2 bg-white border border-red-100 rounded-lg px-3 py-2">
                <span className="text-red-600 text-xs font-bold flex-shrink-0">✕</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {dnk.address || `${dnk.lat?.toFixed(4)}, ${dnk.lng?.toFixed(4)}`}
                  </p>
                  {dnk.reason && <p className="text-xs text-gray-400 truncate">{dnk.reason}</p>}
                </div>
                <button onClick={() => handleRemoveDnk(dnk.id)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create/Edit Territory Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full bg-white rounded-t-3xl shadow-2xl px-5 pt-5 pb-8 max-h-[82vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-base">
                {editingId ? 'Edit Territory' : 'Name Your Territory'}
              </h3>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Name</label>
            <input autoFocus placeholder="e.g. Zone Alpha, Maple District" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 mb-4" />

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block">
              Category <span className="text-gray-400 normal-case font-normal">(optional)</span>
            </label>
            <input placeholder="e.g. Window Cleaning, Lawn Care" value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 mb-1" />
            <p className="text-[11px] text-gray-400 mb-4">
              A tag shown to reps in their Next Stops inbox — helps them match zones to the service they sell.
            </p>

            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 block">Color</label>
            <div className="flex gap-2 flex-wrap mb-4">
              {TERRITORY_COLORS.map((c) => (
                <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all"
                  style={{ backgroundColor: c, borderColor: form.color === c ? '#0F172A' : 'transparent' }}>
                  {form.color === c && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>

            <div className="flex items-baseline justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Priority for</label>
              <span className="text-[11px] text-gray-400">All reps can see this zone either way</span>
            </div>
            {allReps.length === 0 && <p className="text-xs text-gray-400 mb-4">No reps available.</p>}
            <div className="space-y-2 mb-5">
              {allReps.map((rep) => {
                const selected = form.repIds.includes(rep.id)
                return (
                  <button key={rep.id} onClick={() => toggleRep(rep.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-colors text-left ${selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{rep.full_name || rep.email}</p>
                      <p className="text-xs text-gray-400">{rep.email}</p>
                    </div>
                  </button>
                )
              })}
            </div>

            {saveError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                {saveError}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-3.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold text-sm">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()}
                className="flex-1 py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                style={{ backgroundColor: BRAND_GREEN }}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Territory'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Live Tab ─────────────────────────────────────────────────────────────────
const REP_COLORS = ['#3B82F6','#8B5CF6','#F59E0B','#EC4899','#10B981','#EF4444','#0EA5E9','#14B8A6','#F97316','#6366F1']

function repInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function elapsedSince(startedAt) {
  if (!startedAt) return '—'
  const secs = Math.floor((Date.now() - new Date(startedAt)) / 1000)
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Session SLA ─────────────────────────────────────────────────────────────
// If a rep has been on a session for >25 minutes without any knocks, the
// session is almost certainly stalled — they got stuck in a long conversation,
// had a personal emergency, or their phone's GPS died. Rather than waking
// the manager, we just flag the rep card + pin red so a glance at the Live
// tab surfaces who needs a check-in. The threshold is generous enough that
// a normal opening conversation won't trip it.
const SLA_MS                 = 25 * 60 * 1000
// If they HAVE knocked but their rate is under this floor, still flag — a
// rep who got 1 knock in 40 min is likely stalled too. We cap the check to
// sessions ≥ 20 min so new sessions don't false-alarm.
const SLA_MIN_ELAPSED_MS     = 20 * 60 * 1000
const SLA_MIN_DOORS_PER_HOUR = 2

export function isSessionStalled(rep, now = Date.now()) {
  const startedAt = rep?.session?.started_at
    ? new Date(rep.session.started_at).getTime()
    : null
  if (!startedAt) return false
  const elapsed = now - startedAt
  if (elapsed < SLA_MIN_ELAPSED_MS) return false
  const doors = Number(rep.session?.doors_knocked) || 0
  // No knocks for 25+ minutes.
  if (doors === 0 && elapsed >= SLA_MS) return true
  // Elapsed ≥ 25 min AND doors/hour below the floor.
  const hours = elapsed / 3600_000
  if (elapsed >= SLA_MS && doors / hours < SLA_MIN_DOORS_PER_HOUR) return true
  return false
}

function LiveTab({ allReps }) {
  const [activeReps, setActiveReps]   = useState([])
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [loading, setLoading]         = useState(true)
  // Rep ids the manager has already acknowledged for this session of
  // the dashboard. Acked rows drop to a "muted" state so reloading or
  // refetching doesn't keep re-flagging a rep the manager has checked in
  // on. Kept local (not persisted) — a full page reload resets acks.
  const [ackedIds, setAckedIds]       = useState(() => new Set())

  const refresh = async () => {
    try {
      const data = await getActiveRepLocations()
      setActiveReps(data)
      setRefreshedAt(new Date())
    } catch (_e) { /* keep showing last data */ }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10000)  // poll every 10s for snappier live view
    // Also refresh immediately when manager's tab regains focus or comes online
    const onFocus = () => refresh()
    const onOnline = () => refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [])

  const activeIds  = new Set(activeReps.map((r) => r.rep_id))
  const inactiveReps = allReps.filter((r) => !activeIds.has(r.id))

  // Annotate each rep with a stalled flag before passing to the map so
  // MapView can color stalled pins red without importing SLA logic.
  const now = Date.now()
  const annotatedReps = activeReps.map((rep) => ({
    ...rep,
    stalled: isSessionStalled(rep, now) && !ackedIds.has(rep.rep_id),
  }))
  const stalledCount = annotatedReps.filter((r) => r.stalled).length
  const ackRep = (repId) =>
    setAckedIds((prev) => {
      const next = new Set(prev)
      next.add(repId)
      return next
    })

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${activeReps.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-sm font-semibold text-gray-800">
            {activeReps.length} rep{activeReps.length !== 1 ? 's' : ''} active now
          </span>
        </div>
        <button onClick={refresh} className="text-xs text-gray-400 hover:text-gray-600">
          {refreshedAt ? `Updated ${format(refreshedAt, 'h:mm:ss a')}` : 'Loading…'}
        </button>
      </div>

      {/* SLA alarm banner — surfaces reps whose session looks stalled. Tapping
          "I've checked in" mutes the banner + red ring for that rep until the
          manager reloads the page. */}
      {stalledCount > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700">
              {stalledCount} rep{stalledCount !== 1 ? 's' : ''} may need a check-in
            </p>
            <p className="text-xs text-red-600/80">
              No knocks logged in 25+ minutes. GPS may have dropped or they could be stuck in a long conversation.
            </p>
          </div>
        </div>
      )}

      {/* Live map */}
      <div style={{ height: '380px' }} className={stalledCount > 0 ? 'mt-3' : ''}>
        {loading ? (
          <div className="flex items-center justify-center h-full bg-gray-50">
            <div className="animate-spin w-8 h-8 rounded-full"
              style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
          </div>
        ) : (
          <MapView repLocations={annotatedReps} className="w-full h-full" followUser={false} />
        )}
      </div>

      {/* Active rep cards */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active Reps</p>
      </div>
      {activeReps.length === 0 && (
        <div className="text-center py-6 text-gray-400 px-4">
          <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No reps are currently active</p>
          <p className="text-xs mt-1">Rep pins appear here when a session is in progress.</p>
        </div>
      )}
      <div className="px-4 pb-3 space-y-2">
        {annotatedReps.map((rep, idx) => {
          const color = REP_COLORS[idx % REP_COLORS.length]
          const sess  = rep.session
          // Stalled cards pop with a red border + soft blush so the manager's
          // eye lands on them first.
          const cardCls = rep.stalled
            ? 'bg-red-50 border-2 border-red-300 rounded-xl px-4 py-3'
            : 'bg-white border border-gray-200 rounded-xl px-4 py-3'
          return (
            <div key={rep.rep_id} className={cardCls}>
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: color }}>
                    {repInitials(rep.user?.full_name)}
                  </div>
                  {rep.stalled && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-white flex items-center justify-center">
                      <span className="block w-1 h-1 rounded-full bg-white" />
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-gray-900 text-sm truncate">{rep.user?.full_name || 'Rep'}</p>
                    {rep.stalled && (
                      <span className="text-[10px] uppercase tracking-wide bg-red-500 text-white font-bold px-1.5 py-0.5 rounded">
                        stalled
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">{elapsedSince(sess?.started_at)} elapsed</p>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-right flex-shrink-0">
                  <span className="text-xs text-gray-400">Doors</span>
                  <span className="text-xs font-bold text-gray-900">{sess?.doors_knocked ?? '—'}</span>
                  <span className="text-xs text-gray-400">Revenue</span>
                  <span className="text-xs font-bold text-green-600">
                    {sess?.revenue_booked != null ? `$${sess.revenue_booked.toFixed(0)}` : '—'}
                  </span>
                </div>
              </div>
              {rep.stalled && (
                <button onClick={() => ackRep(rep.rep_id)}
                  className="mt-2.5 w-full py-1.5 rounded-lg bg-white border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors">
                  I've checked in
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Inactive reps */}
      {inactiveReps.length > 0 && (
        <div className="px-4 pt-2 pb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Not Active</p>
          <div className="flex flex-wrap gap-2">
            {inactiveReps.map((rep) => (
              <div key={rep.id} className="flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1">
                <div className="w-2 h-2 rounded-full bg-gray-300" />
                <span className="text-xs text-gray-500">{rep.full_name || rep.email}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Leaderboard Tab ──────────────────────────────────────────────────────────
// Gold/silver/bronze medal treatment for the top three podium slots. Indexed
// by rank (0 = 1st), and undefined for 4th+ so the card falls back to the
// neutral white/gray style. Gradients are hand-picked to read as the right
// metal at a glance without going costume-jewelry shiny — enough saturation
// to pop against the white card background, tempered so it doesn't fight the
// KnockIQ blue in the header.
const MEDALS = [
  { label: 'Gold',   emoji: '🥇', gradient: 'linear-gradient(135deg, #F5C542 0%, #D4941E 100%)', cardClass: 'border-yellow-300 bg-yellow-50' },
  { label: 'Silver', emoji: '🥈', gradient: 'linear-gradient(135deg, #D6DCE4 0%, #9AA5B3 100%)', cardClass: 'border-gray-300 bg-gray-50' },
  { label: 'Bronze', emoji: '🥉', gradient: 'linear-gradient(135deg, #D99363 0%, #9E5A2F 100%)', cardClass: 'border-orange-300 bg-orange-50' },
]

function LeaderboardTab() {
  const [period, setPeriod]         = useState('today')
  const [sortBy, setSortBy]         = useState('revenue')
  const [rows, setRows]             = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    setLoading(true)
    getLeaderboardData(period)
      .then(setRows)
      .finally(() => setLoading(false))
  }, [period])

  const sorted = [...rows].sort((a, b) => b[sortBy] - a[sortBy])

  const COLS = [
    { key: 'doors',         label: 'Doors'   },
    { key: 'conversations', label: 'Convos'  },
    { key: 'bookings',      label: 'Booked'  },
    { key: 'revenue',       label: 'Revenue' },
  ]

  return (
    <div className="flex flex-col">
      {/* Controls */}
      <div className="px-4 py-3 bg-white border-b flex items-center gap-2">
        {['today', 'week', 'month'].map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${period === p ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
            style={period === p ? { backgroundColor: BRAND_GREEN } : {}}>
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-8 h-8 rounded-full"
            style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-gray-400 px-4">
          <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-sm">No activity yet</p>
          <p className="text-xs mt-1">Data appears here once reps start sessions.</p>
        </div>
      ) : (
        <div className="px-4 pt-4 pb-8 space-y-3">
          {/* Sort chips */}
          <div className="flex gap-2 flex-wrap">
            <span className="text-xs text-gray-500 font-medium self-center mr-1">Sort by:</span>
            {COLS.map(({ key, label }) => (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${sortBy === key ? 'text-white' : 'bg-gray-100 text-gray-500'}`}
                style={sortBy === key ? { backgroundColor: BRAND_GREEN } : {}}>
                {label}
              </button>
            ))}
          </div>

          {/* Leaderboard rows */}
          {sorted.map((rep, i) => {
            const closeRate = rep.doors > 0 ? ((rep.bookings / rep.doors) * 100).toFixed(1) : '0'
            const medal     = MEDALS[i]  // null for 4th place and beyond
            return (
              <div key={rep.id}
                className={`relative rounded-2xl border p-4 ${medal ? medal.cardClass : 'border-gray-200 bg-white'}`}>
                {/* Medal ribbon — pinned to the top-right corner of the card
                    for 1st/2nd/3rd, purely decorative alongside the rank badge. */}
                {medal && (
                  <div
                    className="absolute -top-2 -right-2 w-9 h-9 rounded-full grid place-items-center text-[18px] shadow-md border-2 border-white"
                    style={{ background: medal.gradient }}
                    aria-label={medal.label}
                    title={medal.label}
                  >
                    {medal.emoji}
                  </div>
                )}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${medal ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
                    style={medal ? { background: medal.gradient } : {}}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate">{rep.name}</p>
                    <p className="text-xs text-gray-400">{rep.bookings} booking{rep.bookings !== 1 ? 's' : ''} · {closeRate}% close rate</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900">${rep.revenue.toFixed(0)}</p>
                    <p className="text-xs text-gray-400">revenue</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-gray-100">
                  <MicroStat label="Doors"   value={rep.doors}         />
                  <MicroStat label="Convos"  value={rep.conversations} />
                  <MicroStat label="Estims"  value={rep.estimates}     />
                  <MicroStat label="Booked"  value={rep.bookings}      />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────
// KPI card + sparkline primitives (RichStatCard, MiniSparkArea, MiniSparkBars,
// RadialGauge, TrendChip) now live in ../components/StatSparkCards.jsx so the
// rep-side home can share the exact same look. Imports at the top of this file.

// Daily Revenue bar chart — stacked grey (estimates-only) behind green
// (booked). Derived from the same sessions the KPI cards use.
function DailyRevenueChart({ daily = [] }) {
  if (!daily.length) return null
  const w = 320, h = 140
  const padL = 30, padR = 8, padT = 12, padB = 28
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  // Scale on combined revenue to reserve headroom for the grey "estimate" cap
  // once we track it separately. For now grey === booked (no estimate $$ yet).
  const maxRev = Math.max(1, ...daily.map((d) => d.revenue))
  const slot = innerW / daily.length
  const barW = Math.min(Math.max(slot * 0.55, 4), 28)

  const yAt = (val) => padT + innerH - (val / maxRev) * innerH
  const yTicks = [0, maxRev / 2, maxRev]

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Daily Revenue</p>
          <p className="text-xs text-gray-500">{daily.length}-day view</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#7ac943' }} />Booked</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#cbd5e1' }} />Estimates</span>
        </div>
      </div>
      {/* aspect ratio matches the viewBox exactly so text + bars scale cleanly */}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36 md:h-auto md:aspect-[16/7]">
        {/* Gridlines */}
        <g stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3">
          {yTicks.map((t, i) => (
            <line key={i} x1={padL} y1={yAt(t)} x2={w - padR} y2={yAt(t)} />
          ))}
        </g>
        {/* Y labels */}
        <g fontSize="9" fill="#94a3b8" textAnchor="end">
          {yTicks.map((t, i) => (
            <text key={i} x={padL - 4} y={yAt(t) + 3}>${formatCompact(t)}</text>
          ))}
        </g>
        {/* Bars */}
        <g>
          {daily.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const x  = cx - barW / 2
            const bookedH = Math.max((d.revenue / maxRev) * innerH, d.revenue > 0 ? 2 : 0)
            const bookedY = padT + innerH - bookedH
            return (
              <g key={i}>
                {d.revenue > 0 && (
                  <rect x={x} y={bookedY} width={barW} height={bookedH} rx="3" fill="#7ac943" />
                )}
              </g>
            )
          })}
        </g>
        {/* X labels (only every-Nth so they don't collide on 30-day view) */}
        <g fontSize="10" fill="#64748b" textAnchor="middle" fontWeight="600">
          {daily.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            const step = Math.ceil(daily.length / 7)
            if (i % step !== 0 && i !== daily.length - 1) return null
            return <text key={i} x={cx} y={h - 8}>{format(d.date, daily.length > 10 ? 'M/d' : 'EEE')}</text>
          })}
        </g>
      </svg>
    </section>
  )
}

// Rep Leaderboard — sorted by revenue, gradient bar normalized to top rep.
// The palette cycles through 5 pastel avatar colors so it matches the
// mockup feel without needing per-rep color meta.
function RepLeaderboard({ repStats = [] }) {
  if (!repStats.length) {
    return (
      <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
        <p className="text-sm font-semibold text-gray-900 mb-2">Rep Leaderboard</p>
        <p className="text-xs text-gray-500">No rep activity in this period.</p>
      </section>
    )
  }
  const top = repStats.slice(0, 5)
  const max = Math.max(1, ...top.map((r) => r.revenue))
  const avatarColors = [
    'bg-lime-200 text-lime-800',
    'bg-blue-200 text-blue-800',
    'bg-teal-200 text-teal-800',
    'bg-violet-200 text-violet-800',
    'bg-orange-200 text-orange-800',
  ]
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Rep Leaderboard</p>
        <p className="text-[11px] text-gray-500">By revenue</p>
      </div>
      <ul className="space-y-3">
        {top.map((r, i) => {
          const pct = (r.revenue / max) * 100
          const close = r.doors > 0 ? ((r.bookings / r.doors) * 100).toFixed(1) : '0'
          return (
            <li key={r.id}>
              <div className="flex items-center gap-3">
                <span className="w-6 text-center text-sm font-extrabold text-gray-400">{i + 1}</span>
                <div className={`w-8 h-8 rounded-full font-bold text-xs grid place-items-center ${avatarColors[i % avatarColors.length]}`}>
                  {repInitials(r.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline">
                    <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                    <p className="text-sm font-extrabold text-gray-900">${formatCompact(r.revenue)}</p>
                  </div>
                  <div className="relative h-2 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <span className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#7ac943,#2757d7)' }} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {r.doors} doors · {r.bookings} jobs · {close}% close · {r.sessions} sessions
                  </p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Overview helpers ────────────────────────────────────────────────────────
// How many days of history the overview's bar chart + sparklines should
// render for a given calendar-period filter. Today=1, week=Mon-to-today,
// month=1st-to-today, all=derived from oldest session (capped so bars stay
// legible). Falls back to 7 if nothing matches.
function daysForRange(range, sessions = []) {
  const now = new Date()
  if (range === 'today') return 1
  if (range === 'week')  return Math.max(1, differenceInCalendarDays(now, startOfWeek(now, { weekStartsOn: 1 })) + 1)
  if (range === 'month') return Math.max(1, now.getDate())
  if (range === 'all') {
    const oldest = sessions.reduce((min, s) => {
      const t = s.started_at ? new Date(s.started_at).getTime() : Infinity
      return t < min ? t : min
    }, Infinity)
    if (!Number.isFinite(oldest)) return 7
    const span = differenceInCalendarDays(now, new Date(oldest)) + 1
    return Math.min(Math.max(span, 1), 30)
  }
  return 7
}

// groupSessionsByDay, computeTrend, downsample, formatCompact are imported
// from ../components/StatSparkCards.jsx at the top of this file so RepHome
// can share the exact same series-math as the Manager Overview.

function MicroStat({ label, value }) {
  return (
    <div className="text-center">
      <p className="font-bold text-gray-900 text-sm">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  )
}

// ─── Tab Bar with scroll-right indicator ─────────────────────────────────────
// Wraps the horizontal tab strip and renders a right-edge fade + a pulsing
// chevron when there's more content to the right. The hint hides once the
// strip is scrolled to (or near) the end, and reappears if the manager
// scrolls back. Uses onScroll rather than an IntersectionObserver to keep
// the component self-contained and avoid a dep.
function TabBar({ tabs, current, onChange }) {
  const scrollerRef = useRef(null)
  const [hasMoreRight, setHasMoreRight] = useState(false)

  const recomputeHint = () => {
    const el = scrollerRef.current
    if (!el) return
    // 12px slop so a near-end scroll still hides the fade.
    setHasMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 12)
  }

  useEffect(() => {
    recomputeHint()
    const el = scrollerRef.current
    if (!el) return
    const onResize = () => recomputeHint()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // When tabs change (e.g. dynamic additions) or the active tab switches
  // we re-check so the indicator stays accurate.
  useEffect(() => { recomputeHint() }, [tabs, current])

  const scrollRight = () => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' })
  }

  return (
    <div className="relative bg-white border-b">
      <div
        ref={scrollerRef}
        onScroll={recomputeHint}
        className="flex overflow-x-auto scrollbar-hide"
      >
        {tabs.map((t) => {
          const Icon   = t.icon
          const active = current === t.id
          return (
            <button key={t.id} onClick={() => onChange(t.id)}
              className={`flex-shrink-0 px-4 py-3 flex flex-col items-center gap-0.5 text-xs font-medium transition-colors min-w-[72px] ${active ? 'border-b-2' : 'text-gray-500'}`}
              style={active ? { color: BRAND_GREEN, borderBottomColor: BRAND_GREEN } : {}}>
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          )
        })}
        {/* Extra right padding creates breathing room for the fade so the
            last tab doesn't sit under the chevron button. */}
        <div className="flex-shrink-0 w-8" aria-hidden="true" />
      </div>

      {hasMoreRight && (
        <>
          {/* Right-edge fade gradient — draws attention to the cut-off. */}
          <div
            className="pointer-events-none absolute top-0 right-0 h-full w-16"
            style={{ background: 'linear-gradient(to left, white 20%, rgba(255,255,255,0))' }}
            aria-hidden="true"
          />
          {/* Tap target that nudges the strip rightward. Pulses so it
              reads as "more over here" rather than a decorative arrow. */}
          <button
            onClick={scrollRight}
            aria-label="Scroll tabs right"
            className="absolute top-1/2 right-1 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center shadow-sm"
            style={{ backgroundColor: BRAND_GREEN, animation: 'knockiq-tab-hint 1.6s ease-in-out infinite' }}
          >
            <ChevronRight className="w-4 h-4 text-white" />
          </button>
          <style>{`
            @keyframes knockiq-tab-hint {
              0%, 100% { transform: translate(0, -50%);     opacity: 0.85; }
              50%      { transform: translate(3px, -50%);   opacity: 1;    }
            }
          `}</style>
        </>
      )}
    </div>
  )
}

// ─── Address Search ──────────────────────────────────────────────────────────
// Lightweight geocoder using OpenStreetMap's Nominatim. No API key required;
// we keep queries short and include a clear User-Agent-equivalent via the
// browser fetch defaults. Returns the top match back to the parent via
// onResult(lat, lng). A "recenter" button runs the parent-supplied handler
// to fit bounds to all activity on the map.
function AddressSearch({ onResult, onRecenter, canRecenter = false, placeholder = 'Search an address, city, or ZIP' }) {
  const [value, setValue]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleSearch(e) {
    e?.preventDefault?.()
    const q = value.trim()
    if (!q) return
    setLoading(true); setError('')
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`)
      const hits = await res.json()
      if (!Array.isArray(hits) || hits.length === 0) {
        setError('No match — try a more specific address.')
        return
      }
      const lat = parseFloat(hits[0].lat)
      const lng = parseFloat(hits[0].lon)
      if (isNaN(lat) || isNaN(lng)) {
        setError('Couldn\'t parse that result.')
        return
      }
      onResult?.(lat, lng)
    } catch (err) {
      setError(err?.message || 'Lookup failed. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-3 py-2">
      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError('') }}
          placeholder={placeholder}
          className="flex-1 text-sm px-1 py-1.5 focus:outline-none bg-transparent"
        />
        {value && (
          <button type="button" onClick={() => { setValue(''); setError('') }}
            className="p-1 text-gray-300 hover:text-gray-500 flex-shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="flex-shrink-0 px-3 py-1.5 rounded-lg text-white text-xs font-semibold disabled:opacity-50"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {loading ? '…' : 'Go'}
        </button>
        {canRecenter && (
          <button
            type="button"
            onClick={onRecenter}
            title="Recenter on activity"
            className="flex-shrink-0 p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        )}
      </form>
      {error && <p className="text-xs text-red-500 mt-1 ml-6">{error}</p>}
    </div>
  )
}
