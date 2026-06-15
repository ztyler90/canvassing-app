import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format, subDays, startOfDay, endOfDay, differenceInCalendarDays } from 'date-fns'
import { Users, DollarSign, Home, TrendingUp, MapPin, BarChart2, LogOut, Map, Plus, Trash2, Edit2, X, Check, Radio, Trophy, Download, Settings, BookOpen, Shield, UserPlus, ChevronRight, AlertTriangle, Search, Crosshair, Sparkles, ArrowRight, Target, Flame, Share2, Copy, Eye, EyeOff, Award, Minus, MessageSquare, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getAllSessions, getAllReps, getManagerMapData, signOut,
  getTerritories, createTerritory, updateTerritory, deleteTerritory,
  setTerritoryAssignments, getAllDoorHistory, getDoNotKnockList,
  addDoNotKnock, removeDoNotKnock,
  getActiveRepLocations, getLeaderboardData, getAllBookings,
  getMyOrganization, getOrgRegionFallback, getSessionGpsTrail,
  getSessionInteractions,
} from '../lib/supabase.js'
import { computeConversion } from '../lib/repStats.js'
import { isProTier, STANDARD_MAX_TERRITORIES, canCreateTerritory } from '../lib/tier.js'
import { ProBadge, ProUpgradeModal } from '../components/ProGate.jsx'
import { ConversionFunnel } from './RepHome.jsx'
import MapView from '../components/MapView.jsx'
import ManagerMap from '../components/ManagerMap.jsx'
import TerritoryMap from '../components/TerritoryMap.jsx'
import PipelineTab from '../components/PipelineTab.jsx'
import ChatPanel   from '../components/ChatPanel.jsx'
import ChatLauncher from '../components/ChatLauncher.jsx'
import ViewModeSwitch from '../components/ViewModeSwitch.jsx'
import { PhotoThumb } from '../lib/photos.jsx'
import {
  RichStatCard, MiniSparkArea, MiniSparkBars, RadialGauge,
  formatCompact, computeTrend, groupSessionsByDay,
  groupSessionsByMonth, monthsCoveringSessions,
} from '../components/StatSparkCards.jsx'

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue
const BRAND_LIME  = '#7DC31E'  // KnockIQ lime (accent)
const TERRITORY_COLORS = ['#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#10B981', '#EF4444', '#0EA5E9', '#14B8A6']

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: BarChart2 },
  { id: 'reps',        label: 'Reps',        icon: Users     },
  { id: 'pipeline',    label: 'Pipeline',    icon: BookOpen  },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy    },
  { id: 'live',        label: 'Live',        icon: Radio     },
  { id: 'map',         label: 'Map',         icon: MapPin    },
  { id: 'territories', label: 'Territories', icon: Map       },
]

// Tabs that suppress the date/rep filter bar.
// Pipeline owns its own filtering (per-stage + per-closer), so its
// global filter bar is hidden too.
const NO_FILTER_TABS = new Set(['territories', 'live', 'leaderboard', 'pipeline'])

// Period options used by the segmented-control filter bar that sits
// just below the tab bar. Labels mirror the manager's mental model
// (Daily / Weekly / Monthly / All time); values match the shared
// dateRange state that drives the Supabase query in ManagerDashboard.
const RANGE_OPTIONS = [
  { value: 'today', label: 'Daily' },
  { value: 'week',  label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'all',   label: 'All time' },
]

// Resolve a period keyword to a concrete { dateFrom, dateTo } ISO pair.
// "today" covers the current day (start-of-day → now). "week" and "month"
// are rolling windows — last 7 and last 30 days — so the dashboard isn't
// awkwardly empty when the manager opens it on the 1st or 2nd of a
// calendar month. "all" floors to the epoch so downstream queries don't
// need a special-case null check.
function resolvePeriod(range) {
  const now    = new Date()
  const dateTo = endOfDay(now).toISOString()
  if (range === 'today') return { dateFrom: startOfDay(now).toISOString(), dateTo }
  if (range === 'week')  return { dateFrom: startOfDay(subDays(now, 6)).toISOString(),  dateTo }
  if (range === 'month') return { dateFrom: startOfDay(subDays(now, 29)).toISOString(), dateTo }
  if (range === 'all')   return { dateFrom: new Date(0).toISOString(), dateTo }
  return { dateFrom: startOfDay(subDays(now, 6)).toISOString(), dateTo }
}

// Pretty label for the banner on the Overview page.
function periodLabel(range) {
  if (range === 'today') return 'Today'
  if (range === 'week')  return 'Last 7 days'
  if (range === 'month') return 'Last 30 days'
  if (range === 'all')   return 'All time'
  return ''
}

export default function ManagerDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Honor a ?tab= deep link (e.g. from a pipeline-notification email's
  // "Open the pipeline →" CTA, which lands on ?tab=pipeline&lead=<id>).
  // Falls back to Overview for missing/unknown values. PipelineTab reads
  // the sibling ?lead param itself to pop the matching record open.
  const [tab, setTab]               = useState(() => {
    const t = searchParams.get('tab')
    return TABS.some((x) => x.id === t) ? t : 'overview'
  })
  const [sessions, setSessions]     = useState([])
  const [reps, setReps]             = useState([])
  const [mapData, setMapData]       = useState([])
  const [bookings, setBookings]     = useState([])
  const [org, setOrg]               = useState(null)
  // Territories used by the Leaderboard tab's territory filter. Loaded
  // alongside reps so the dropdown is populated on first render rather
  // than after a click.
  const [territoriesLite, setTerritoriesLite] = useState([])
  const [loading, setLoading]       = useState(true)
  const [dateRange, setDateRange]   = useState('month')
  const [selectedRep, setSelectedRep] = useState('all')
  // First-time onboarding callout — points new owners at Settings to
  // finish company setup (services, daily goal, team). Dismissal is
  // stored per-org in localStorage so it doesn't reappear once the
  // owner has dismissed it, even if they reload before adding any
  // reps. Initialized synchronously from localStorage so the banner
  // doesn't flash-on-then-vanish on first render.
  const [setupDismissed, setSetupDismissed] = useState(() => {
    if (typeof window === 'undefined' || !user?.organization_id) return false
    try {
      return localStorage.getItem(`knockiq:onboarding-callout:${user.organization_id}`) === '1'
    } catch { return false }
  })

  useEffect(() => { loadData() }, [dateRange, selectedRep])

  // If the user object loaded AFTER mount (the initial useState reads
  // before user.organization_id is available), sync the dismissed flag
  // from localStorage once we have an org id to key on.
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.organization_id) return
    try {
      const flag = localStorage.getItem(`knockiq:onboarding-callout:${user.organization_id}`) === '1'
      setSetupDismissed(flag)
    } catch { /* localStorage blocked — show the banner, it's not critical */ }
  }, [user?.organization_id])

  function dismissSetupCallout() {
    setSetupDismissed(true)
    try {
      if (user?.organization_id) {
        localStorage.setItem(`knockiq:onboarding-callout:${user.organization_id}`, '1')
      }
    } catch { /* best-effort */ }
  }

  async function loadData() {
    setLoading(true)
    // Calendar-period semantics: today / this week (Mon-start) / this month
    // / all time. "All time" uses the epoch as a lower bound so downstream
    // queries don't need a special code path.
    const { dateFrom, dateTo } = resolvePeriod(dateRange)
    const filters  = { dateFrom, dateTo, ...(selectedRep !== 'all' ? { repId: selectedRep } : {}) }

    const [sess, repList, interactions, bkgs, myOrg, terrs] = await Promise.all([
      getAllSessions(filters),
      getAllReps(),
      getManagerMapData(filters),
      // Fetch both booked and unbooked (estimate_requested) rows so the
      // Bookings tab's sub-nav can switch between them without re-fetching.
      getAllBookings({ ...filters, outcome: 'all' }),
      getMyOrganization(),
      // Territories drive the Leaderboard's territory dropdown. Cheap query
      // and rarely changes mid-session, so it's safe to refresh on every
      // dashboard load instead of caching separately.
      getTerritories(),
    ])
    setSessions(sess)
    setReps(repList)
    setMapData(interactions)
    setBookings(bkgs)
    setOrg(myOrg)
    setTerritoriesLite(terrs)
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
  // Close rate = conversation → booked job (bookings ÷ conversations). A "close"
  // only happens once a rep has actually spoken with a homeowner, so measuring
  // it against conversations — not raw doors — is the honest denominator.
  const closeRate          = totalConversations > 0 ? ((totalBookings / totalConversations) * 100).toFixed(1) : '0'
  const revenuePerDoor     = totalDoors > 0 ? (totalRevenue / totalDoors).toFixed(2) : '0'

  // Org-configured terminology flows into the funnel so the Estimates row
  // re-labels to "Appointments" for teams that prefer that verbiage.
  const countLabel     = org?.count_goal_label === 'appointments' ? 'Appointments' : 'Estimates'

  const repMap = {}
  sessions.forEach((s) => {
    const repName = s.users?.full_name || s.rep_id
    if (!repMap[s.rep_id]) {
      repMap[s.rep_id] = { id: s.rep_id, name: repName, sessions: 0, doors: 0, bookings: 0, revenue: 0, estimates: 0, conversations: 0 }
    }
    const r = repMap[s.rep_id]
    r.sessions++; r.doors += s.doors_knocked || 0; r.bookings += s.bookings || 0
    r.revenue += s.revenue_booked || 0; r.estimates += s.estimates || 0
    r.conversations += s.conversations || 0
  })
  const repStats = Object.values(repMap).sort((a, b) => b.revenue - a.revenue)

  // "Needs setup" = a brand-new org with no reps and no canvassing activity.
  // We don't gate on `org.created_at` because the better signal is "have they
  // actually started using it yet" — an owner who joined 3 weeks ago but
  // never finished setup still benefits from the nudge. Once they add a rep
  // or log a single session, the cue goes away on its own.
  const needsSetup  = !loading && reps.length === 0 && sessions.length === 0
  const showCallout = needsSetup && !setupDismissed

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Sticky chrome — header + (optional) setup callout + tab bar. The
          wrapper uses `sticky top-0 z-30` so when the content area scrolls
          (whether via the inner overflow-y-auto on desktop or page scroll
          on mobile/native), the brand header and the Overview/Reps/Pipeline
          tabs stay pinned to the top of the viewport. A solid bg on the
          wrapper prevents the gradient from showing through any margin
          gap once we leave the rendering of the header itself. */}
      <div className="sticky top-0 z-30 bg-gray-50">
      {/* Header */}
      <div className="px-5 pt-12 pb-4 bg-brand-header">
        <div className="max-w-7xl mx-auto w-full">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <img
                src="/logo-white.png"
                alt="KnockIQ"
                className="h-9 w-auto object-contain shrink-0"
              />
              <div>
                <div className="flex items-center gap-1.5">
                  {user?.organization?.name && (
                    <span className="text-blue-200 text-sm">{user.organization.name}</span>
                  )}
                </div>
              </div>
            </div>
            {/* On narrow screens the Canvass/Manager pill stacks ABOVE the
                icon row so a long org name + the pill + five icons don't all
                fight for one line. From sm+ everything sits inline again. */}
            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
              {/* Manager ⇄ Canvassing switch — only renders for platform
                  managers. Lets a manager who also knocks jump into the rep
                  canvassing UI and back. */}
              <ViewModeSwitch />
              <div className="flex items-center gap-2">
              {user?.is_super_admin && (
                <button
                  onClick={() => navigate('/super-admin')}
                  title="Super-Admin Dashboard"
                  className="p-2 rounded-full bg-white/20 ring-1 ring-white/40">
                  <Shield className="w-5 h-5 text-white" />
                </button>
              )}
              {/* Team Chat — sits just before the gear so reps and managers
                  reach for it in the same place. Owns its own panel + unread
                  badge; nothing else in the header needs to know about chat. */}
              <ChatLauncher />

              {/* Gear icon — gets a pulsing lime ring + small dot when the
                  org still needs setup, so a new owner has an obvious
                  visual breadcrumb pointing them to Settings. The ring
                  uses Tailwind's animate-ping on an absolutely-positioned
                  sibling so the button itself stays still (animating the
                  ring instead of the button keeps the icon click target
                  steady). Cue disappears the moment reps.length > 0 or
                  any session is logged. */}
              <button
                onClick={() => navigate('/settings')}
                className="relative p-2 rounded-full bg-white/20"
                aria-label={needsSetup ? 'Settings (setup recommended)' : 'Settings'}
              >
                {needsSetup && (
                  <>
                    <span
                      className="pointer-events-none absolute inset-0 rounded-full animate-ping"
                      style={{ backgroundColor: BRAND_LIME, opacity: 0.45 }}
                      aria-hidden="true"
                    />
                    <span
                      className="pointer-events-none absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: BRAND_LIME }}
                      aria-hidden="true"
                    />
                  </>
                )}
                <Settings className="w-5 h-5 text-white relative" />
              </button>
              <button onClick={signOut} className="p-2 rounded-full bg-white/20">
                <LogOut className="w-5 h-5 text-white" />
              </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trial banner */}
      {user?.organization?.status === 'trial' && user?.organization?.trial_ends_at && (() => {
        const msLeft = new Date(user.organization.trial_ends_at).getTime() - Date.now()
        const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)))
        const isExpired = msLeft <= 0
        return (
          <div className={`px-4 py-2 text-sm font-medium ${isExpired ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
            <div className="max-w-7xl mx-auto w-full text-center">
              {isExpired
                ? 'Your free trial has ended. Upgrade to keep using KnockIQ.'
                : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your free trial.`}
            </div>
          </div>
        )
      })()}

      {/* First-run setup callout — visible across every tab so a new owner
          can't miss it. Sits below the trial banner intentionally: trial
          status is the most time-sensitive info; this is the next step.
          Dismissible (per-org localStorage). Self-hides the moment the
          owner has any rep or session activity, so it can't survive into
          a real working state. */}
      {showCallout && (
        <div className="px-4 pt-3">
          <div className="max-w-7xl mx-auto w-full">
            <div
              className="relative rounded-2xl border-2 p-4 sm:p-5 flex items-start gap-3 shadow-sm"
              style={{ borderColor: BRAND_LIME, backgroundColor: '#F7FCE8' }}
            >
              <div
                className="hidden sm:flex w-11 h-11 rounded-xl items-center justify-center shrink-0"
                style={{ backgroundColor: BRAND_LIME }}
              >
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0 pr-6">
                <p className="font-bold text-gray-900 text-sm sm:text-base">
                  Welcome to KnockIQ — let's finish setting up your company
                </p>
                <p className="text-gray-700 text-xs sm:text-sm mt-0.5 leading-relaxed">
                  Head to <span className="font-semibold">Settings</span> to add your services,
                  set a daily goal, and invite your reps. Takes about two minutes.
                </p>
                <button
                  onClick={() => navigate('/settings')}
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-xs font-bold"
                  style={{ backgroundColor: BRAND_GREEN }}
                >
                  Open Settings
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={dismissSetupCallout}
                aria-label="Dismiss setup callout"
                className="absolute top-2 right-2 p-1.5 rounded-md text-gray-500 hover:bg-black/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab Bar — horizontally scrollable for 7 tabs. A right-edge fade
          + pulsing chevron signals to the manager that more tabs (Map,
          Territories) live past the fold. The hint fades away once they
          scroll within ~12px of the end. */}
      <TabBar tabs={TABS} current={tab} onChange={setTab} />
      </div>{/* /sticky chrome wrapper */}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${!NO_FILTER_TABS.has(tab) ? 'px-4 py-5 pb-8' : ''}`}>
        {!NO_FILTER_TABS.has(tab) && loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-8 h-8 rounded-full"
              style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
          </div>
        ) : (
          <div className={!NO_FILTER_TABS.has(tab) ? 'max-w-7xl mx-auto w-full space-y-4' : ''}>
            {/* Filter controls — Period segmented control + Rep dropdown,
                right-aligned in the content area so they sit in the light-gray
                space just below the tab bar. Hidden on tabs that don't honor
                these filters (Live / Leaderboard / Territories). */}
            {!NO_FILTER_TABS.has(tab) && (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <SegmentedControl
                  label="Period"
                  value={dateRange}
                  onChange={setDateRange}
                  options={RANGE_OPTIONS}
                />
                <PillDropdown
                  label="Rep"
                  value={selectedRep}
                  onChange={setSelectedRep}
                  options={[
                    { value: 'all', label: 'All Reps' },
                    ...reps.map((r) => ({ value: r.id, label: r.full_name || r.email })),
                  ]}
                />
              </div>
            )}
            {tab === 'overview' && (
              <OverviewTab sessions={sessions} totalRevenue={totalRevenue} totalDoors={totalDoors}
                totalBookings={totalBookings} totalEstimates={totalEstimates}
                totalConversations={totalConversations}
                closeRate={closeRate} revenuePerDoor={revenuePerDoor}
                countLabel={countLabel}
                repStats={repStats}
                bookings={bookings}
                org={org}
                onJumpToTab={setTab}
                dateRange={dateRange} />
            )}
            {tab === 'live'        && <LiveTab allReps={reps} />}
            {tab === 'leaderboard' && <LeaderboardTab territories={territoriesLite} countLabel={countLabel} />}
            {tab === 'reps'        && <RepsTab repStats={repStats} allReps={reps} sessions={sessions} dateRange={dateRange} />}
            {tab === 'pipeline'    && <PipelineTab />}
            {tab === 'map'         && <ManagerMap interactions={mapData} allReps={reps} />}
            {tab === 'territories' && <TerritoryTab allReps={reps} managerId={user?.id} org={org} />}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({
  sessions, totalRevenue, totalDoors, totalBookings, totalEstimates,
  totalConversations = 0, closeRate, revenuePerDoor, countLabel = 'Estimates',
  repStats = [], bookings = [], org = null, onJumpToTab,
  dateRange = '7',
}) {
  const navigate = useNavigate()
  const [showExportUpsell, setShowExportUpsell] = useState(false)
  const totalHours     = sessions.reduce((sum, s) => {
    if (!s.started_at || !s.ended_at) return sum
    return sum + (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
  }, 0)
  const revenuePerHour = totalHours > 0 ? (totalRevenue / totalHours).toFixed(0) : '—'
  // Doors / Hour = canvassing pace. Lets a manager spot who's slow-walking vs.
  // moving fast, and (paired with close rate / rev-per-door) whether speed
  // actually correlates with success or just burns through doors.
  const doorsPerHour   = totalHours > 0 ? (totalDoors / totalHours).toFixed(1) : '—'

  // ── Series for sparklines + the Revenue bar chart ─────────────────────
  // We bucket either by day or by month depending on the selected period.
  // Daily buckets work great for "today / week / month" (a manageable
  // number of bars) but produce a noisy/empty chart for "all time" once
  // an org has months of history. For "all" we switch to month buckets
  // so the X axis stays legible regardless of tenure.
  //
  //   today/week/month → groupSessionsByDay  (zero-filled daily bars)
  //   all              → groupSessionsByMonth (zero-filled monthly bars,
  //                       capped at 24 so labels stay readable)
  const bucketUnit = dateRange === 'all' ? 'month' : 'day'
  const series = bucketUnit === 'month'
    ? groupSessionsByMonth(sessions, monthsCoveringSessions(sessions))
    : groupSessionsByDay(sessions, daysForRange(dateRange, sessions))

  // Trend chips compare the last half of the window to the first half.
  // Honest, no extra DB call — if the back half outpaces the front, ▲.
  // The math works identically on day-bucket and month-bucket series.
  const revenueTrend  = computeTrend(series, 'revenue')
  const doorsTrend    = computeTrend(series, 'doors')
  const bookingsTrend = computeTrend(series, 'bookings')

  // Close Rate goal: manager-declared via Settings → Close Rate Goal, stored on
  // organizations.close_rate_goal. Falls back to 5.0% when the manager hasn't
  // set one. Measured as conversation → booked job (bookings ÷ conversations).
  const goalCloseRate = Number(org?.close_rate_goal) > 0 ? Number(org.close_rate_goal) : 5.0
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
      ['Doors / Hour', doorsPerHour !== '—' ? doorsPerHour : '—'],
      ['Total Sessions', sessions.length],
      ['Total Hours Canvassing', `${totalHours.toFixed(1)}`],
      [],
    ]

    // ── Section 2: Per-Rep Breakdown ────────────────────────────────
    const repMap = {}
    sessions.forEach((s) => {
      const key = s.rep_id
      if (!repMap[key]) repMap[key] = { name: s.users?.full_name || s.rep_id, sessions: 0, doors: 0, conversations: 0, bookings: 0, estimates: 0, revenue: 0, hours: 0 }
      const r = repMap[key]
      r.sessions++
      r.doors         += s.doors_knocked  || 0
      r.conversations += s.conversations  || 0
      r.bookings      += s.bookings       || 0
      r.estimates     += s.estimates      || 0
      r.revenue       += s.revenue_booked || 0
      if (s.started_at && s.ended_at)
        r.hours += (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
    })
    const repRows = [
      ['REP BREAKDOWN'],
      ['Name', 'Sessions', 'Doors', 'Bookings', 'Estimates', 'Close % (conv→booked)', 'Revenue', 'Hours'],
      ...Object.values(repMap).sort((a, b) => b.revenue - a.revenue).map((r) => {
        const cr = r.conversations > 0 ? ((r.bookings / r.conversations) * 100).toFixed(1) : '0'
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

  // Export (CSV + Google Sheets) is a Pro feature. Standard orgs see the
  // buttons grayed out and get an upgrade prompt if they click.
  const exportIsPro = isProTier(org)
  function handleExport(fn) {
    if (!exportIsPro) { setShowExportUpsell(true); return }
    fn()
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ── Period banner ─────────────────────────────────────────────────
         Echoes the filter bar's date-range selection right on the overview
         so there's never any doubt about the window the numbers cover. */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team overview</p>
        <p className="text-sm text-slate-600">
          {periodLabel(dateRange)}{repStats.length > 0 ? ` · ${repStats.length} rep${repStats.length === 1 ? '' : 's'} active` : ''}
        </p>
      </div>

      {/* ── KPI cards — 2×2 on mobile, 4-across on desktop ─────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <RichStatCard
          label="Revenue Booked"
          value={`$${formatCompact(totalRevenue)}`}
          trend={revenueTrend}
          trendLabel="revenue booked"
          icon={<DollarSign className="w-4 h-4" />}
          gradient="from-lime-100 via-lime-50 to-white"
          border="border-lime-200/60"
          iconColor="text-lime-700"
        >
          <MiniSparkArea
            values={series.map((d) => d.revenue)}
            dates={series.map((d) => d.date)}
            bucketUnit={bucketUnit}
            valueFormatter={(v) => `$${formatCompact(v)}`}
            color="#5ea636" fill="#7ac94373"
          />
        </RichStatCard>

        <RichStatCard
          label="Doors Knocked"
          value={totalDoors.toLocaleString()}
          trend={doorsTrend}
          trendLabel="doors knocked"
          icon={<Home className="w-4 h-4" />}
          gradient="from-blue-100 via-blue-50 to-white"
          border="border-blue-200/60"
          iconColor="text-blue-700"
        >
          <MiniSparkBars
            values={series.map((d) => d.doors)}
            dates={series.map((d) => d.date)}
            bucketUnit={bucketUnit}
            valueFormatter={(v) => `${Math.round(v).toLocaleString()} doors`}
            color="#2757d7" highlight="#1e44b0"
          />
        </RichStatCard>

        <RichStatCard
          label="Jobs Booked"
          value={totalBookings.toLocaleString()}
          trend={bookingsTrend}
          trendLabel="jobs booked"
          icon={<TrendingUp className="w-4 h-4" />}
          gradient="from-teal-100 via-teal-50 to-white"
          border="border-teal-200/60"
          iconColor="text-teal-700"
        >
          <MiniSparkArea
            values={series.map((d) => d.bookings)}
            dates={series.map((d) => d.date)}
            bucketUnit={bucketUnit}
            valueFormatter={(v) => `${Math.round(v).toLocaleString()} ${v === 1 ? 'job' : 'jobs'}`}
            color="#0d9488" fill="#14b8a673"
          />
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
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5">Conversation → booked job</p>
            </div>
          </div>
        </RichStatCard>
      </div>

      {/* ── Daily Revenue + Rep Leaderboard (2-col on desktop) ────────── */}
      {/* items-start so each card hugs its own content height — otherwise the
         grid stretches the chart card to match the taller leaderboard and
         leaves dead space below the bars. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
        <DailyRevenueChart series={series} bucketUnit={bucketUnit} />
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
        {/* Performance Metrics — styled to match the Conversion Funnel's
           type ramp and rhythm (bg-white rounded-2xl shadow-sm + p-5/6,
           same header weight, same row spacing) so the two columns read
           as a balanced pair instead of the older table-row look. */}
        <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4 md:mb-5">
            <p className="text-gray-800 font-semibold text-base md:text-lg flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-gray-400" /> Performance Metrics
            </p>
            <p className="text-xs md:text-sm font-semibold text-gray-600 bg-gray-50 px-3 py-1 rounded-full">
              this period
            </p>
          </div>
          {/* Row spacing intentionally matches ConversionFunnel's space-y-4
             md:space-y-5 so card heights track each other on desktop and
             the right column doesn't bottom out short. */}
          <div className="space-y-4 md:space-y-5">
            {[
              ['Revenue / Hour',         `$${revenuePerHour}`],
              ['Revenue / Door',         `$${revenuePerDoor}`],
              ['Doors / Hour',           doorsPerHour === '—' ? '—' : `${doorsPerHour} / hr`],
              ['Estimates Requested',    totalEstimates.toLocaleString()],
              ['Sessions',               sessions.length.toLocaleString()],
              ['Total Hours Canvassing', `${totalHours.toFixed(1)} hrs`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-gray-800 text-sm md:text-base">{label}</span>
                <span className="font-bold text-gray-900 text-sm md:text-base tabular-nums">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* ── Bottom 2×2 grid ───────────────────────────────────────────────
         Four cards stacked on mobile, two-up on desktop. Pairing was chosen
         to balance "look-back" panels (Recent Sessions, Top Areas) with
         "look-forward / act-now" panels (Open Estimates, Bottleneck), so
         each row reads as one backward + one forward signal. */}
      {sessions.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <RecentSessionsCard
            sessions={sessions}
            countLabel={countLabel}
            onOpen={(id) => navigate('/session/' + id)}
          />
          <GoalTrackerCard
            totalRevenue={totalRevenue}
            totalEstimates={totalEstimates}
            countLabel={countLabel}
            sessions={sessions}
            org={org}
            dateRange={dateRange}
          />
          <TopAreasCard
            sessions={sessions}
            onJumpToTerritories={() => onJumpToTab?.('territories')}
          />
          <ConversionBottleneckCard
            stats={{
              doors:         totalDoors,
              conversations: totalConversations,
              estimates:     totalEstimates,
              bookings:      totalBookings,
            }}
            countLabel={countLabel}
          />
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No sessions in this period</p>
          <p className="text-sm mt-1">Try expanding the date range.</p>
        </div>
      )}
      {/* Export buttons — compact, bottom of page. Pro feature: grayed for
          Standard orgs with a Pro badge, upgrade prompt on click. */}
      <div className="flex items-center gap-2 justify-end pt-1">
        {!exportIsPro && <ProBadge />}
        <button onClick={() => handleExport(exportCSV)} title={exportIsPro ? 'Export CSV' : 'Export is a Pro feature'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white ${exportIsPro ? '' : 'opacity-50'}`}
          style={{ backgroundColor: BRAND_GREEN }}>
          {exportIsPro ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          CSV
        </button>
        <button onClick={() => handleExport(openInSheets)} title={exportIsPro ? 'Open in Google Sheets' : 'Export is a Pro feature'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 text-gray-600 bg-white ${exportIsPro ? '' : 'opacity-50'}`}>
          {exportIsPro ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" fill="#34A853" opacity=".15"/>
              <path d="M3 9h18M3 15h18M9 3v18" stroke="#34A853" strokeWidth="1.5"/>
            </svg>
          ) : <Lock className="w-3.5 h-3.5" />}
          Sheets
        </button>
      </div>
      <ProUpgradeModal
        open={showExportUpsell}
        onClose={() => setShowExportUpsell(false)}
        feature="Export to CSV & Google Sheets"
        blurb="Download your full team breakdown and session log, or push it straight into Google Sheets. Available on the Pro plan."
        perks={['CSV export of summary, per-rep & session log', 'One-click Open in Google Sheets', 'Commission tracking & expanded pipeline']}
      />
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
          const lineItems = Array.isArray(b.service_line_items) ? b.service_line_items : []
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

              {/* Itemized estimate breakdown — the per-service prices the rep
                  quoted, ready to lift into a CRM proposal. Only shown when the
                  rep used itemized mode. */}
              {lineItems.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
                    {lineItems.map((li, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-gray-100 last:border-b-0"
                      >
                        <span className="text-gray-600 truncate pr-2">{li.service}</span>
                        <span className="font-semibold text-gray-800 tabular-nums">
                          ${Number(li.price || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Photo thumbnails */}
              {photos.length > 0 && (
                <div className="px-4 pb-3 flex gap-1.5 flex-wrap">
                  {photos.map((url, i) => (
                    <PhotoThumb
                      key={i}
                      pathOrUrl={url}
                      bucket="interaction-photos"
                      alt={`Photo ${i + 1}`}
                      className="w-16 h-16 rounded-xl object-cover border border-gray-200 active:opacity-75"
                    />
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
function RepsTab({ repStats, allReps = [], sessions = [], dateRange = 'month' }) {
  const navigate = useNavigate()

  // Per-rep hours worked, summed from session start/end timestamps. We
  // derive this here (vs. baking it into repStats) so the broader dashboard
  // computation stays a hot path: the Rankings card is the only consumer.
  const hoursByRep = {}
  sessions.forEach((s) => {
    if (!s.started_at || !s.ended_at) return
    const h = (new Date(s.ended_at) - new Date(s.started_at)) / 3600000
    hoursByRep[s.rep_id] = (hoursByRep[s.rep_id] || 0) + h
  })

  // Bucket sessions by rep so each card can render its own daily series of
  // revenue/doors/bookings — the "graphical performance metrics per rep"
  // surface. Window length follows the active dateRange filter to keep
  // visual scale consistent with the overview's hero sparklines.
  const sessionsByRep = {}
  sessions.forEach((s) => {
    if (!s.rep_id) return
    if (!sessionsByRep[s.rep_id]) sessionsByRep[s.rep_id] = []
    sessionsByRep[s.rep_id].push(s)
  })
  const chartDays = daysForRange(dateRange, sessions)

  // Enrich each rep with the derived metrics the Rankings card can sort by.
  // Stays in repStats order (sorted by revenue) so the card list below
  // doesn't reshuffle when a manager picks a different ranking metric.
  const enriched = repStats.map((r) => {
    const hours = hoursByRep[r.id] || 0
    return {
      ...r,
      hours,
      closeRate:      r.conversations > 0 ? (r.bookings / r.conversations) * 100 : 0,
      revenuePerDoor: r.doors > 0 ? r.revenue / r.doors          : 0,
      revenuePerHour: hours    > 0 ? r.revenue / hours           : 0,
      doorsPerHour:   hours    > 0 ? r.doors   / hours           : 0,
    }
  })

  // Reps who are on the team but produced no sessions in the current window.
  const activeIds = new Set(repStats.map((r) => r.id))
  const idleReps  = allReps.filter((r) => !activeIds.has(r.id))

  const handleAddRep    = () => navigate('/settings', { state: { openAddRep: true } })
  const handleOpenRep   = (repId) => navigate(`/manager/rep/${repId}`)

  return (
    <div className="space-y-3">
      {/* Performance rankings — full-width graphical leaderboard with metric
         toggle pills. Defaults to revenue (matches the Overview's hero card). */}
      <RepRankings repStats={enriched} onOpenRep={handleOpenRep} />

      {/* Active reps with per-rep performance graphs. Each card visualizes
         the rep's daily revenue / doors / bookings trend over the active
         dateRange window — same series math the overview hero cards use,
         so this is a per-rep miniature of that view. */}
      {repStats.map((rep, i) => {
        const cr = rep.conversations > 0 ? ((rep.bookings / rep.conversations) * 100).toFixed(1) : '0'
        const repSessions = sessionsByRep[rep.id] || []
        const daily       = groupSessionsByDay(repSessions, chartDays)
        const dates       = daily.map((d) => d.date)
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

            {/* ── Performance metrics, graphical ────────────────────────
               Three mini-charts side-by-side: revenue area, doors bars,
               bookings area. Same series math as overview hero cards. */}
            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-100">
              <RepMetricMini
                label="Revenue"
                value={`$${formatCompact(rep.revenue)}`}
                variant="area"
                values={daily.map((d) => d.revenue)}
                dates={dates}
                color="#5ea636"
                fill="#7ac94340"
                valueFormatter={(v) => `$${formatCompact(v)}`}
              />
              <RepMetricMini
                label="Doors"
                value={rep.doors.toLocaleString()}
                variant="bars"
                values={daily.map((d) => d.doors)}
                dates={dates}
                color="#2757d7"
                highlight="#1e44b0"
              />
              <RepMetricMini
                label="Jobs"
                value={rep.bookings.toLocaleString()}
                variant="area"
                values={daily.map((d) => d.bookings)}
                dates={dates}
                color="#0d9488"
                fill="#14b8a640"
              />
            </div>

            {/* Existing numeric stat row — at-a-glance ratios the
               sparklines above don't surface (estimates + close% +
               efficiency). */}
            <div className="grid grid-cols-3 gap-2 pt-3 mt-2 border-t border-gray-100">
              <MicroStat label="Estimates"  value={rep.estimates}   />
              <MicroStat label="Close %"    value={`${cr}%`}        />
              <MicroStat label="Rev / Door" value={rep.doors > 0 ? `$${(rep.revenue / rep.doors).toFixed(0)}` : '—'} />
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

// ─── Per-rep mini metric ────────────────────────────────────────────────────
// Compact, captioned sparkline used inside RepsTab's rep cards. Label on
// top, big number under it, mini-chart fills the rest. Stays a passive
// visual — the outer rep card is what's clickable for drill-in.
function RepMetricMini({ label, value, variant, values, dates, color, fill, highlight, valueFormatter }) {
  const empty = !values || values.every((v) => !v)
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</p>
      <p className="text-sm font-bold text-gray-900 leading-tight">{value}</p>
      {empty ? (
        <div className="w-full h-9 md:h-10 mt-1 rounded bg-slate-50" />
      ) : variant === 'bars' ? (
        <MiniSparkBars
          values={values}
          dates={dates}
          color={color}
          highlight={highlight}
          valueFormatter={valueFormatter}
        />
      ) : (
        <MiniSparkArea
          values={values}
          dates={dates}
          color={color}
          fill={fill}
          valueFormatter={valueFormatter}
        />
      )}
    </div>
  )
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────
// Map tab now lives in ../components/ManagerMap.jsx — the in-file version
// here grew far beyond what was reasonable to nest inside the dashboard
// (clustering, heatmap, territory overlay, filter panel, summary panel,
// time scrubber, context menu, PNG share). The dashboard mounts
// <ManagerMap interactions={mapData} allReps={reps} /> directly.

// ─── Territory Tab ────────────────────────────────────────────────────────────
function TerritoryTab({ allReps, managerId, org = null }) {
  const [territories, setTerritories] = useState([])
  const [showTerritoryUpsell, setShowTerritoryUpsell] = useState(false)
  const [doorHistory, setDoorHistory] = useState([])
  const [doNotKnock, setDoNotKnock]   = useState([])
  const [loading, setLoading]         = useState(true)
  // Org "home region" — fed to TerritoryMap so a brand-new org with no
  // drawn polygons lands on its actual service area instead of Tampa.
  // Fetched once on mount; the map handles the case where it arrives
  // after init.
  const [regionFallback, setRegionFallback] = useState(null)
  useEffect(() => {
    let alive = true
    getOrgRegionFallback().then((r) => { if (alive) setRegionFallback(r) })
    return () => { alive = false }
  }, [])
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
  // Wrapper around the <TerritoryMap> so "tap a zone" can scroll the
  // map into view on mobile, where the list sits below the fold.
  const mapContainerRef = useRef(null)
  // Highlights the row whose polygon is currently framed — a subtle
  // nudge so the manager can match "I tapped this" to "the map just
  // flew here."
  const [focusedTerritoryId, setFocusedTerritoryId] = useState(null)

  useEffect(() => { loadAll() }, [])

  // Tap a zone row → fly/zoom the map to that polygon's bounds and
  // scroll the map into view if it's scrolled off-screen. Ignored if
  // the territory has no polygon (shouldn't happen since create
  // requires one, but defensive).
  function focusTerritory(territory) {
    if (!territory?.polygon || !Array.isArray(territory.polygon) || territory.polygon.length === 0) return
    setFocusedTerritoryId(territory.id)
    mapRef.current?.fitToPolygon(territory.polygon, 17)
    // Smooth-scroll so the manager actually sees the result — on
    // mobile the zones list can be a full screen below the map.
    mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
        // Backstop: enforce the Standard cap even if the UI gate is bypassed.
        if (atTerritoryCap) {
          setShowForm(false); setNewPolygon(null)
          setShowTerritoryUpsell(true)
          setSaving(false)
          return
        }
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

  // Standard tier is capped at 50 territories; Pro is unlimited (51+).
  const territoryIsPro = isProTier(org)
  const atTerritoryCap = !canCreateTerritory(org, territories.length)

  // Wrap the existing draw trigger so hitting the Standard cap shows an
  // upgrade prompt instead of starting a draw that can't be saved.
  function startDrawGated() {
    if (atTerritoryCap) { setShowTerritoryUpsell(true); return }
    startDraw()
  }

  if (loading) return (
    <div className="flex justify-center py-24">
      <div className="animate-spin w-8 h-8 rounded-full"
        style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
    </div>
  )

  return (
    <div className="flex flex-col max-w-7xl mx-auto w-full">
      <ProUpgradeModal
        open={showTerritoryUpsell}
        onClose={() => setShowTerritoryUpsell(false)}
        feature="51+ territories"
        blurb={`The Standard plan covers up to ${STANDARD_MAX_TERRITORIES} territories. Upgrade to Pro to add unlimited territories as your team grows.`}
        perks={['Unlimited territories (51+)', 'Commission tracking & export']}
      />
      {/* Control bar */}
      <div className="px-4 py-3 bg-white border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-semibold text-gray-800 text-sm">
              {territories.length} {territories.length === 1 ? 'territory' : 'territories'}
            </p>
            {!territoryIsPro && (
              <span className="text-[11px] text-gray-400 font-medium">
                {territories.length}/{STANDARD_MAX_TERRITORIES} on Standard
              </span>
            )}
          </div>
          {!drawing && (
            <button onClick={startDrawGated}
              title={atTerritoryCap ? `Standard is capped at ${STANDARD_MAX_TERRITORIES} territories — upgrade to Pro for 51+` : 'Draw a new territory'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold ${atTerritoryCap ? 'opacity-50' : ''}`}
              style={{ backgroundColor: BRAND_GREEN }}>
              {atTerritoryCap ? <Lock className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />} Draw Territory
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
      <div ref={mapContainerRef} style={{ height: '380px', scrollMarginTop: '64px' }}>
        <TerritoryMap
          ref={mapRef}
          territories={territories}
          doorHistory={doorHistory}
          doNotKnock={doNotKnock}
          onPolygonComplete={handlePolygonComplete}
          onDrawPointsChange={setDrawPts}
          onEditTerritory={openEditForm}
          className="w-full h-full"
          autoFit
          regionFallback={regionFallback}
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

      {/* Two-column body: zones list on the left, per-zone performance
          metrics on the right. Stacks vertically on small screens —
          same pattern as LiveTab so managers get a consistent reading
          order across the dashboard. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pt-4 pb-6">
        {/* ── Left column: zones list ──────────────────────────────── */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Map className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Zones
            </p>
            <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
              {territories.length}
            </span>
          </div>

          {territories.length === 0 && (
            <div className="text-center py-8 text-gray-400 rounded-xl border border-dashed border-gray-200 bg-white">
              <Map className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No territories yet.</p>
              <p className="text-xs mt-1">Click "Draw Territory" and outline a zone on the map.</p>
            </div>
          )}

          {territories.map((t) => {
            const assignedReps = (t.territory_assignments || []).map((a) => a.users?.full_name).filter(Boolean)
            const isFocused = focusedTerritoryId === t.id
            return (
              // The whole card is now a tap target that zooms the map
              // to this zone's polygon. Edit/Delete buttons stop
              // propagation so they keep their original behavior.
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => focusTerritory(t)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusTerritory(t) } }}
                className={`bg-white rounded-xl border p-3 cursor-pointer transition-colors active:bg-gray-50 ${isFocused ? 'ring-2 ring-blue-400 border-blue-300' : 'border-gray-200 hover:border-gray-300'}`}
                style={isFocused ? { backgroundColor: `${t.color}0A` } : undefined}
                aria-label={`Zoom map to ${t.name}`}
              >
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
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditForm(t) }}
                    className="p-1.5 text-gray-400 hover:text-blue-500"
                    aria-label="Edit zone"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}
                    className="p-1.5 text-gray-400 hover:text-red-500"
                    aria-label="Delete zone"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1 ml-5">
                  {assignedReps.length ? `Priority for ${assignedReps.join(', ')}` : 'Visible to everyone'}
                </p>
              </div>
            )
          })}

          {/* DNK Section — stays in the left column underneath the
              zones list because both are map-management surfaces. */}
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
        </section>

        {/* ── Right column: per-zone performance metrics ───────────── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Performance by Zone
            </p>
          </div>
          <ZonePerformanceList
            territories={territories}
            doorHistory={doorHistory}
            focusedTerritoryId={focusedTerritoryId}
            onFocus={focusTerritory}
          />
        </section>
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

// ─── Per-Zone Performance ────────────────────────────────────────────────────
// Right-column companion to the zones list. Computes door-history metrics
// for each polygon (point-in-polygon over the full org history) and
// renders one card per zone with the same focus/click-to-zoom hook the
// list uses — clicking either side highlights and frames the same zone.

/** Ray-casting point-in-polygon. polygon = [[lat,lng], ...] */
function pipLatLng(lat, lng, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i]
    const [yj, xj] = polygon[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function zoneTimeAgo(dateStr) {
  if (!dateStr) return 'Never'
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}wk ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}yr ago`
}

function computeZoneMetrics(territory, doorHistory) {
  if (!territory?.polygon || !Array.isArray(territory.polygon) || territory.polygon.length < 3) {
    return { doors: 0, conversations: 0, estimates: 0, bookings: 0, closeRate: null, lastAt: null }
  }
  const inside = doorHistory.filter(
    (i) => i.lat != null && i.lng != null && pipLatLng(i.lat, i.lng, territory.polygon)
  )
  let conversations = 0, estimates = 0, bookings = 0
  let lastAt = null
  for (const i of inside) {
    if (i.outcome !== 'no_answer') conversations += 1
    if (i.outcome === 'estimate_requested') estimates += 1
    if (i.outcome === 'booked') {
      bookings += 1
      // Bookings count as estimates too — every booked door was first
      // estimated, even if the rep skipped the estimate-requested step.
      // Without this, "100% close rate" is unreachable in zones where
      // reps booked on the spot without separately logging an estimate.
      estimates += 1
    }
    if (i.created_at && (!lastAt || new Date(i.created_at) > new Date(lastAt))) {
      lastAt = i.created_at
    }
  }
  // Close rate = conversation → booked job (bookings ÷ conversations), matching
  // the org-wide definition used on the Overview and Leaderboard.
  const closeRate = conversations > 0 ? Math.round((bookings / conversations) * 100) : null
  return { doors: inside.length, conversations, estimates, bookings, closeRate, lastAt }
}

function ZonePerformanceList({ territories, doorHistory, focusedTerritoryId, onFocus }) {
  if (!territories || territories.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 rounded-xl border border-dashed border-gray-200 bg-white">
        <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No zone metrics yet</p>
        <p className="text-xs mt-1">Draw a territory to see knocks, conversations, and close rate by zone.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {territories.map((t) => {
        const m = computeZoneMetrics(t, doorHistory)
        const isFocused = focusedTerritoryId === t.id
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => onFocus?.(t)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus?.(t) } }}
            className={`bg-white rounded-xl border p-3 cursor-pointer transition-colors active:bg-gray-50 ${isFocused ? 'ring-2 ring-blue-400 border-blue-300' : 'border-gray-200 hover:border-gray-300'}`}
            style={isFocused ? { backgroundColor: `${t.color}0A` } : undefined}
            aria-label={`Zoom map to ${t.name}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: t.color }} />
              <p className="font-semibold text-gray-900 text-sm flex-1 truncate">{t.name}</p>
              <span className="text-[10px] text-gray-400 font-medium tabular-nums whitespace-nowrap">
                Last: {zoneTimeAgo(m.lastAt)}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ZoneStat label="Doors"  value={m.doors} />
              <ZoneStat label="Convos" value={m.conversations} />
              <ZoneStat label="Est"    value={m.estimates} />
              <ZoneStat label="Booked" value={m.bookings} accent="green" />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-gray-400">
                Conv rate{' '}
                <span className="font-semibold text-gray-700 tabular-nums">
                  {m.doors > 0 ? `${Math.round((m.conversations / m.doors) * 100)}%` : '—'}
                </span>
              </span>
              <span className="text-gray-400">
                Close rate{' '}
                <span className="font-semibold text-gray-700 tabular-nums">
                  {m.closeRate != null ? `${m.closeRate}%` : '—'}
                </span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ZoneStat({ label, value, accent }) {
  const valueClass = accent === 'green' ? 'text-green-600' : 'text-gray-900'
  return (
    <div className="bg-gray-50 rounded-lg px-2 py-1.5 text-center">
      <p className={`text-sm font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">{label}</p>
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
  // Currently-focused rep — the one we just zoomed to via list click.
  // Drives a soft highlight on the card so the manager remembers what
  // they're looking at on the map.
  const [focusedRepId, setFocusedRepId] = useState(null)
  // GPS trail of the focused rep, drawn as a glowing/fading/marching-ants line
  // on the live map. Only one rep's trail shows at a time; tapping another rep
  // swaps it. Re-fetched on each poll (below) so it grows as the rep walks.
  const [focusTrail, setFocusTrail] = useState([])
  // Live door markers + per-rep walking paths for EVERY active rep — so the
  // manager's live map mirrors what each rep sees on their own canvassing
  // screen (color-coded outcome dots + the GPS line trail), not just a bare
  // "current position" pin. Refreshed on each poll so dots/paths grow live.
  const [liveInteractions, setLiveInteractions] = useState([])
  const [repTrails, setRepTrails] = useState([])
  // Phase 6: rep id the manager wants to DM. When set, ChatPanel mounts
  // open and points at that user. Null = chat panel closed.
  const [dmRepId, setDmRepId] = useState(null)
  // Ref to the MapView so list clicks can drive map.flyTo without a
  // full re-render or prop-drilling a moving target into MapView.
  const mapRef = useRef(null)

  // Pan + zoom the map onto a rep when their list card is tapped OR
  // their pin is tapped on the map. 18.25 keeps just enough block
  // context around the pin to read the street pattern; the 0.75s flyTo
  // duration we get from MapView itself.
  // Timestamp of the last focus action. The focus flyTo animates down to
  // zoom 18.25; we ignore viewport events for a moment after focusing so the
  // fly-in (and MapView's initial viewport callback) don't immediately trip
  // the auto-unfocus below.
  const focusGuardRef = useRef(0)

  const focusRep = (rep) => {
    if (!rep || rep.lat == null || rep.lng == null) return
    focusGuardRef.current = Date.now()
    mapRef.current?.flyTo(rep.lat, rep.lng, 18.25)
    setFocusedRepId(rep.rep_id)
  }

  // Auto-clear the focused rep (and its trail) once the manager zooms back out
  // to survey the team. Threshold sits below the focus zoom (18.25) and the
  // all-reps view (~17) so it only fires on a deliberate zoom-out.
  const UNFOCUS_ZOOM = 16.5
  const handleViewportChange = useCallback(({ zoom }) => {
    if (!focusedRepId) return
    if (Date.now() - focusGuardRef.current < 1200) return  // ignore the fly-in itself
    if (zoom != null && zoom < UNFOCUS_ZOOM) setFocusedRepId(null)
  }, [focusedRepId])

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

  // Fetch (and keep fresh) the focused rep's GPS trail. Re-runs whenever the
  // focus changes or activeReps refreshes (every 10s poll), so the glowing
  // trail extends live as the rep moves. Clears when nothing is focused.
  useEffect(() => {
    if (!focusedRepId) { setFocusTrail([]); return }
    const rep = activeReps.find((r) => r.rep_id === focusedRepId)
    const sid = rep?.session_id || rep?.session?.id
    if (!sid) { setFocusTrail([]); return }
    let alive = true
    getSessionGpsTrail(sid)
      .then((pts) => { if (alive) setFocusTrail((pts || []).map((p) => ({ lat: p.lat, lng: p.lng }))) })
      .catch(() => { /* keep last trail on a transient fetch error */ })
    return () => { alive = false }
  }, [focusedRepId, activeReps])

  // Fetch every active rep's door interactions (the outcome dots) + GPS trail
  // (their walking path) so the live map shows the same markings the rep sees.
  // Re-runs on each 10s poll (activeReps changes) so dots and paths extend live
  // as reps knock and walk. Each rep's path is colored to match its REP_COLORS
  // slot so the manager can tell whose line is whose at a glance.
  useEffect(() => {
    const active = activeReps.filter((r) => r.session_id || r.session?.id)
    if (active.length === 0) { setLiveInteractions([]); setRepTrails([]); return }
    let alive = true
    Promise.all(
      active.map(async (rep) => {
        const sid = rep.session_id || rep.session?.id
        const [ints, trail] = await Promise.all([
          getSessionInteractions(sid).catch(() => []),
          getSessionGpsTrail(sid).catch(() => []),
        ])
        return { rep, ints: ints || [], trail: trail || [] }
      })
    )
      .then((results) => {
        if (!alive) return
        const allInts = []
        const trails = []
        results.forEach(({ rep, ints, trail }) => {
          const idx = activeReps.findIndex((r) => r.rep_id === rep.rep_id)
          const color = REP_COLORS[(idx >= 0 ? idx : 0) % REP_COLORS.length]
          ints.forEach((i) => { if (i.lat != null && i.lng != null) allInts.push(i) })
          const pts = trail.map((p) => ({ lat: p.lat, lng: p.lng }))
          if (pts.length >= 2) trails.push({ repId: rep.rep_id, color, points: pts })
        })
        setLiveInteractions(allInts)
        setRepTrails(trails)
      })
      .catch(() => { /* keep last markers on a transient fetch error */ })
    return () => { alive = false }
  }, [activeReps])

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

  // Team-wide live totals — summed across every active session right
  // now. Pure derivation; no extra fetch needed. Kept inline (not
  // memoized) because the slice is tiny and `activeReps` rebuilds on
  // every 10s poll anyway.
  const teamTotals = annotatedReps.reduce(
    (acc, r) => {
      const s = r.session
      if (!s) return acc
      acc.doors        += Number(s.doors_knocked  || 0)
      acc.conversations+= Number(s.conversations  || 0)
      acc.estimates    += Number(s.estimates      || 0)
      acc.bookings     += Number(s.bookings       || 0)
      acc.revenue      += Number(s.revenue_booked || 0)
      return acc
    },
    { doors: 0, conversations: 0, estimates: 0, bookings: 0, revenue: 0 }
  )
  const topRepNow = annotatedReps.reduce(
    (best, r) => {
      const rev = Number(r.session?.revenue_booked || 0)
      const doors = Number(r.session?.doors_knocked || 0)
      // Prefer revenue when there is any; fall back to doors so an
      // early-in-the-day team still surfaces a leader.
      const score = rev > 0 ? rev : doors
      return score > best.score ? { rep: r, score, by: rev > 0 ? 'revenue' : 'doors' } : best
    },
    { rep: null, score: 0, by: null }
  )

  return (
    <div className="flex flex-col h-full max-w-7xl mx-auto w-full">
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

      {/* SLA alarm banner — surfaces reps whose session looks stalled.
          Sits above both columns since the alert applies team-wide. */}
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

      {/* Live map — stays full-width above the two-column body so the
          manager always has spatial context while scanning rep details. */}
      <div style={{ height: '380px' }} className={stalledCount > 0 ? 'mt-3' : ''}>
        {loading ? (
          <div className="flex items-center justify-center h-full bg-gray-50">
            <div className="animate-spin w-8 h-8 rounded-full"
              style={{ borderWidth: 3, borderStyle: 'solid', borderColor: `${BRAND_GREEN} transparent transparent transparent` }} />
          </div>
        ) : (
          <MapView
            ref={mapRef}
            repLocations={annotatedReps}
            interactions={liveInteractions}
            repTrails={repTrails}
            trail={focusTrail}
            onRepClick={focusRep}
            onViewportChange={handleViewportChange}
            className="w-full h-full"
            followUser={false}
          />
        )}
      </div>

      {/* Two-column body: rep cards on the left, team-wide live metrics
          on the right. Stacks vertically on small screens. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pt-4 pb-6">
        {/* ── Left column: active reps ─────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Radio className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Active Reps
            </p>
            <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
              {activeReps.length}
            </span>
          </div>
          {activeReps.length === 0 ? (
            <div className="text-center py-6 text-gray-400 rounded-xl border border-dashed border-gray-200 bg-white">
              <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No reps active right now</p>
              <p className="text-xs mt-1">Rep cards appear here when a session is in progress.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {annotatedReps.map((rep, idx) => (
                <ActiveRepCard
                  key={rep.rep_id}
                  rep={rep}
                  color={REP_COLORS[idx % REP_COLORS.length]}
                  focused={focusedRepId === rep.rep_id}
                  onFocus={() => focusRep(rep)}
                  onAck={() => ackRep(rep.rep_id)}
                  onChat={() => setDmRepId(rep.rep_id)}
                />
              ))}
            </div>
          )}

          {/* Inactive reps — collapsed to chips below the active list */}
          {inactiveReps.length > 0 && (
            <div className="mt-4">
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
        </section>

        {/* ── Right column: team-wide live metrics ─────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Team Live Metrics
            </p>
          </div>
          <TeamLiveMetrics
            totals={teamTotals}
            activeCount={activeReps.length}
            stalledCount={stalledCount}
            topRepNow={topRepNow}
          />
        </section>
      </div>

      {/* Chat panel — opens via the in-card message button. Mounts only
          when a rep is targeted so we don't carry an extra subscription
          when nobody's actively chatting. */}
      {dmRepId && (
        <ChatPanel
          open={!!dmRepId}
          initialDmUserId={dmRepId}
          onClose={() => setDmRepId(null)}
        />
      )}
    </div>
  )
}

/**
 * Single active-rep card in the LiveTab left column. Kept as its own
 * component because the new chat button + stalled state + click-to-
 * focus interactions add enough complexity that inlining hurt
 * readability. The card stays a <div> (not a <button>) so the inner
 * chat button can capture its own clicks without an event-stop dance.
 */
function ActiveRepCard({ rep, color, focused, onFocus, onAck, onChat }) {
  const sess = rep.session
  // Card styling priority: stalled (red) > focused (blue ring) > default.
  // Stalled wins because that signal is more urgent than "you clicked me."
  const cardCls = rep.stalled
    ? 'bg-red-50 border-2 border-red-300'
    : focused
      ? 'bg-blue-50 border-2 border-blue-400 ring-2 ring-blue-100'
      : 'bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onFocus}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFocus() } }}
      className={`rounded-xl px-3.5 py-3 transition-colors cursor-pointer ${cardCls}`}
      title="Zoom map to this rep"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: color }}
          >
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
            <p className="font-semibold text-gray-900 text-sm truncate">
              {rep.user?.full_name || 'Rep'}
            </p>
            {rep.stalled && (
              <span className="text-[10px] uppercase tracking-wide bg-red-500 text-white font-bold px-1.5 py-0.5 rounded">
                stalled
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">{elapsedSince(sess?.started_at)} elapsed</p>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-right shrink-0">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Doors</span>
          <span className="text-xs font-bold text-gray-900 tabular-nums">{sess?.doors_knocked ?? '—'}</span>
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Est</span>
          <span className="text-xs font-bold text-gray-900 tabular-nums">{sess?.estimates ?? '—'}</span>
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Rev</span>
          <span className="text-xs font-bold text-green-600 tabular-nums">
            {sess?.revenue_booked != null ? `$${sess.revenue_booked.toFixed(0)}` : '—'}
          </span>
        </div>
        {/* Chat button — opens a DM with this rep through the existing
            ChatPanel. stopPropagation so a tap on the icon doesn't
            zoom the map to the rep's location at the same time. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChat() }}
          title="Message this rep"
          className="shrink-0 p-2 rounded-lg text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
      </div>
      {rep.stalled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAck() }}
          className="mt-2.5 block w-full text-center py-1.5 rounded-lg bg-white border border-red-300 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors"
        >
          I've checked in
        </button>
      )}
    </div>
  )
}

/**
 * Team Live Metrics — the right-column content. Five small tiles + a
 * top-performer callout. Numbers are sums across active sessions only
 * (not historical), so they read as the team's current snapshot rather
 * than "today so far."
 */
function TeamLiveMetrics({ totals, activeCount, stalledCount, topRepNow }) {
  // Conversion derived from the live totals. If nobody's knocked yet
  // we render an em-dash rather than 0% so the manager doesn't read a
  // false "0% close rate" before the team has had a chance.
  const closeRate = totals.estimates > 0
    ? ((totals.bookings / totals.estimates) * 100).toFixed(0) + '%'
    : '—'
  const convoRate = totals.doors > 0
    ? ((totals.conversations / totals.doors) * 100).toFixed(0) + '%'
    : '—'
  return (
    <div className="space-y-3">
      {/* Top tile — health summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-3.5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">
            Right now
          </p>
          {stalledCount > 0 && (
            <span className="text-[10px] uppercase tracking-wide bg-red-500 text-white font-bold px-1.5 py-0.5 rounded">
              {stalledCount} stalled
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-extrabold text-gray-900 tabular-nums">{activeCount}</p>
          <p className="text-sm font-semibold text-gray-500">active session{activeCount === 1 ? '' : 's'}</p>
        </div>
      </div>

      {/* 2×2 metric tiles */}
      <div className="grid grid-cols-2 gap-2">
        <LiveMetricTile label="Doors knocked"  value={totals.doors.toLocaleString()} />
        <LiveMetricTile label="Conversations"  value={totals.conversations.toLocaleString()}
                        hint={convoRate !== '—' ? `${convoRate} of doors` : null} />
        <LiveMetricTile label="Estimates"      value={totals.estimates.toLocaleString()} />
        <LiveMetricTile label="Bookings"       value={totals.bookings.toLocaleString()}
                        hint={closeRate !== '—' ? `${closeRate} of estimates` : null} />
      </div>

      {/* Revenue — full-width emphasis since dollars are the headline */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 p-3.5">
        <p className="text-[10px] uppercase font-bold tracking-wider text-green-700">
          Revenue this shift
        </p>
        <p className="text-3xl font-extrabold text-green-700 tabular-nums leading-none mt-1">
          ${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </div>

      {/* Top performer callout */}
      {topRepNow.rep && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-3.5 flex items-center gap-3">
          <span className="text-2xl">🏆</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase font-bold tracking-wider text-amber-700">
              Leading right now
            </p>
            <p className="text-sm font-bold text-gray-900 truncate">
              {topRepNow.rep.user?.full_name || 'Rep'}
            </p>
            <p className="text-[11px] text-amber-700">
              {topRepNow.by === 'revenue'
                ? `$${Number(topRepNow.score).toFixed(0)} booked`
                : `${topRepNow.score} doors`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function LiveMetricTile({ label, value, hint }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3">
      <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400">{label}</p>
      <p className="text-2xl font-extrabold text-gray-900 tabular-nums leading-none mt-1">{value}</p>
      {hint && <p className="text-[10px] text-gray-500 mt-0.5">{hint}</p>}
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

// Deterministic avatar color from a name string — same name always lands on
// the same hue so reps are recognizable across sessions. Hand-picked palette
// reads against the white card background and the gold hero gradient without
// fighting the KnockIQ lime accent.
const AVATAR_PALETTE = [
  '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#EF4444', '#0EA5E9', '#14B8A6',
  '#A855F7', '#F97316',
]
function colorForName(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length]
}
function initialsFor(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}
function Avatar({ name, size = 36, ring = false }) {
  return (
    <div
      className={`rounded-full grid place-items-center font-bold text-white shrink-0 ${ring ? 'ring-2 ring-white' : ''}`}
      style={{ width: size, height: size, background: colorForName(name), fontSize: size * 0.4 }}
    >
      {initialsFor(name)}
    </div>
  )
}

// Rank-movement chip. ▲n green, ▼n red, — slate, or NEW pill if the rep had
// no prior-period rank.
function RankMovement({ current, prior }) {
  if (prior == null) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold">NEW</span>
    )
  }
  const delta = prior - current
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-slate-400 text-[10px] font-bold"><Minus className="w-3 h-3" /></span>
    )
  }
  const up = delta > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
      <span className="leading-none">{up ? '▲' : '▼'}</span>{Math.abs(delta)}
    </span>
  )
}

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'week',  label: 'This Week' },
  { value: 'month', label: 'This Month' },
]
// Sort options are built dynamically so the count metric (estimates) wears
// the org's preferred label ("Estimates" or "Appointments"). Order matters:
// the count metric leads because for setter-driven teams it's the KPI; we
// keep Revenue available but demote it down the row.
function buildSortOptions(countLabel) {
  return [
    { key: 'estimates',     label: countLabel || 'Estimates' },
    { key: 'bookings',      label: 'Booked'  },
    { key: 'doors',         label: 'Doors'   },
    { key: 'conversations', label: 'Convos'  },
    { key: 'closeRate',     label: 'Close %' },
    { key: 'revenue',       label: 'Revenue' },
    { key: 'revPerDoor',    label: '$/Door'  },
  ]
}
function projectSortValue(rep, key) {
  if (!rep) return 0
  if (key === 'closeRate')  return rep.conversations > 0 ? (rep.bookings / rep.conversations) : 0
  if (key === 'revPerDoor') return rep.doors > 0 ? (rep.revenue  / rep.doors) : 0
  return rep[key] || 0
}

function LeaderboardTab({ territories = [], countLabel = 'Estimates' }) {
  // Default sort is the count metric ("Estimates" / "Appointments") because for
  // setter-driven teams (solar, roofing, pest, etc.) booked appointments is the
  // headline KPI — revenue lands later as a back-of-pipeline indicator. The
  // sort list itself is rebuilt with the org's preferred label.
  const sortOptions = buildSortOptions(countLabel)
  const [period,    setPeriod]    = useState('today')
  const [sortBy,    setSortBy]    = useState('estimates')
  const [rows,      setRows]      = useState([])
  const [loading,   setLoading]   = useState(true)
  // "Share view" — hides revenue $ so the board can be posted publicly
  // without surfacing comp-sensitive numbers.
  const [redact,    setRedact]    = useState(false)
  // Territory filter — 'all' shows the org-wide board, otherwise we restrict
  // rows to reps assigned to the selected territory. Multi-territory reps
  // appear under each of their territories.
  const [territory, setTerritory] = useState('all')
  const [shareMsg,  setShareMsg]  = useState('') // transient "Copied!" feedback

  useEffect(() => {
    setLoading(true)
    getLeaderboardData(period)
      .then(setRows)
      .finally(() => setLoading(false))
  }, [period])

  // Set of rep IDs assigned to the currently selected territory. Empty set
  // means "no filter" — see filtered() below.
  const repIdsInTerritory = (() => {
    if (territory === 'all') return null
    const t = territories.find((x) => x.id === territory)
    if (!t) return new Set()
    return new Set((t.territory_assignments || []).map((a) => a.rep_id))
  })()
  const visible = repIdsInTerritory ? rows.filter((r) => repIdsInTerritory.has(r.id)) : rows
  const sorted = [...visible].sort((a, b) => projectSortValue(b, sortBy) - projectSortValue(a, sortBy))
  // Prior-period rank by the same metric the manager is sorting on, so the
  // movement chip means "moved up in revenue" when sorted by revenue, etc.
  // Also restricted to the territory filter so the rank delta reflects
  // movement *within* that territory, not the whole org.
  const priorRankByRepId = (() => {
    const withPrior = visible
      .filter((r) => r.prior)
      .map((r) => ({ id: r.id, val: projectSortValue(r.prior, sortBy) }))
      .sort((a, b) => b.val - a.val)
    const out = {}
    withPrior.forEach((r, i) => { out[r.id] = i + 1 })
    return out
  })()

  const team = sorted.reduce((acc, r) => ({
    revenue:       acc.revenue       + (r.revenue       || 0),
    doors:         acc.doors         + (r.doors         || 0),
    bookings:      acc.bookings      + (r.bookings      || 0),
    // For setter teams "estimates" IS the appointment count — we keep summing
    // it under the same key so downstream renderers stay simple, and label-
    // swap at display time.
    estimates:     acc.estimates     + Math.max(r.estimates || 0, r.bookings || 0),
    conversations: acc.conversations + (r.conversations || 0),
  }), { revenue: 0, doors: 0, bookings: 0, estimates: 0, conversations: 0 })
  const teamCloseRate = team.conversations > 0 ? ((team.bookings / team.conversations) * 100).toFixed(1) : '0.0'

  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label || 'Today'

  async function copyAsText() {
    const lines = []
    lines.push(`🏆 KnockIQ Leaderboard — ${periodLabel}`)
    // Lead with appointments (estimates) since that's the setter KPI; revenue
    // tags on at the end only when "Show $" is enabled.
    lines.push(`Team: ${team.estimates} ${countLabel.toLowerCase()} · ${team.bookings} booked · ${team.doors} doors · ${teamCloseRate}% close${redact ? '' : ` · $${formatCompact(team.revenue)}`}`)
    lines.push('')
    sorted.slice(0, 10).forEach((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`
      const cr    = r.conversations > 0 ? ((r.bookings / r.conversations) * 100).toFixed(0) : '0'
      const $$    = redact ? '' : ` · $${formatCompact(r.revenue)}`
      const streak = r.streakDays > 1 ? ` 🔥${r.streakDays}` : ''
      const pr     = r.isPR ? ' ⭐PR' : ''
      const apt    = Math.max(r.estimates || 0, r.bookings || 0)
      lines.push(`${medal} ${r.name} — ${apt} ${countLabel.toLowerCase()} · ${r.bookings} booked · ${r.doors} doors · ${cr}%${$$}${streak}${pr}`)
    })
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setShareMsg('Copied to clipboard')
    } catch {
      setShareMsg('Copy failed')
    }
    setTimeout(() => setShareMsg(''), 1600)
  }

  async function downloadAsPng() {
    const svg = buildLeaderboardShareSvg({ sorted, periodLabel, team, teamCloseRate, redact, countLabel })
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()
    img.onload = () => {
      const scale = 2  // retina-quality export
      const canvas = document.createElement('canvas')
      canvas.width  = img.width  * scale
      canvas.height = img.height * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((png) => {
        URL.revokeObjectURL(url)
        if (!png) { setShareMsg('Image export failed'); setTimeout(() => setShareMsg(''), 1600); return }
        const a = document.createElement('a')
        a.href     = URL.createObjectURL(png)
        a.download = `leaderboard-${period}-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        setShareMsg('Downloaded')
        setTimeout(() => setShareMsg(''), 1600)
      }, 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); setShareMsg('Image export failed'); setTimeout(() => setShareMsg(''), 1600) }
    img.src = url
  }

  // Leader on the active sort metric — drives the pace-bar denominator in
  // each row so "% of leader" stays honest no matter what we're sorting by.
  const top = sorted[0]

  return (
    <div className="flex flex-col max-w-7xl mx-auto w-full">
      {/* ─── Sticky control strip ─────────────────────────────────────────
          Period + Sort + Anonymize + Share live together so they stay
          accessible while the manager scrolls a long roster. */}
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="px-4 py-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {PERIOD_OPTIONS.map((p) => {
              const active = period === p.value
              return (
                <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}>
                  {p.label}
                </button>
              )
            })}
          </div>

          {/* Territory filter — restricts the board to a specific zone's
              reps. Hidden when the org has no territories so the strip
              doesn't show a useless one-option dropdown. */}
          {territories.length > 0 && (
            <select
              value={territory}
              onChange={(e) => setTerritory(e.target.value)}
              className="text-xs font-semibold rounded-lg bg-white text-slate-700 ring-1 ring-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              title="Filter by territory"
            >
              <option value="all">All territories</option>
              {territories.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}

          <div className="flex-1" />

          {/* Share-view (anonymize $) toggle */}
          <button
            type="button"
            onClick={() => setRedact((v) => !v)}
            title={redact ? 'Show revenue' : 'Hide revenue ($) for public sharing'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ring-1 transition-colors ${redact ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          >
            {redact ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {redact ? 'Hidden $' : 'Show $'}
          </button>

          <button
            type="button"
            onClick={copyAsText}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>

          <button
            type="button"
            onClick={downloadAsPng}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm hover:opacity-95"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <Share2 className="w-3.5 h-3.5" /> Share PNG
          </button>
        </div>

        <div className="px-4 pb-3 flex gap-2 flex-wrap items-center">
          <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mr-1">Sort by</span>
          {sortOptions.map(({ key, label }) => {
            const active = sortBy === key
            return (
              <button key={key} onClick={() => setSortBy(key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${active ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                style={active ? { backgroundColor: BRAND_GREEN } : {}}>
                {label}
              </button>
            )
          })}
          {shareMsg && (
            <span className="ml-auto text-[11px] font-semibold text-emerald-600">{shareMsg}</span>
          )}
        </div>
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
          {/* Team totals — collective headline for the period. Leads with the
              count metric ("Appointments" / "Estimates") since that's the KPI
              for setter teams. */}
          <TeamTotalsStrip team={team} closeRate={teamCloseRate} redact={redact} periodLabel={periodLabel} repCount={sorted.length} countLabel={countLabel} />

          {/* Unified row list — every rank (including #1) uses the same row
              shape so the eye scans the full board without re-orienting. #1's
              card still gets the gold medal corner + tint via MEDALS[0], but
              the layout itself is identical to every other row. */}
          {sorted.map((rep, idx) => {
            const rank = idx + 1
            const closeRate  = rep.conversations > 0 ? ((rep.bookings / rep.conversations) * 100).toFixed(1) : '0.0'
            const revPerDoor = rep.doors > 0 ? (rep.revenue / rep.doors) : 0
            // For setter teams a booking is always an appointment too — mirror
            // the funnel math used elsewhere so a historical session with raw
            // estimates < bookings doesn't display a smaller appointment count
            // than its booked count.
            const apt        = Math.max(rep.estimates || 0, rep.bookings || 0)
            const medal      = MEDALS[rank - 1]   // gold/silver/bronze for ranks 1-3
            // Pace bar denominator: leader's value on the *active* sort metric
            // (appointments by default). Keeps the "% of leader" cue honest no
            // matter what the manager is sorting on.
            const topVal     = projectSortValue(top, sortBy)
            const myVal      = projectSortValue(rep, sortBy)
            const pacePct    = topVal > 0 ? Math.min(100, (myVal / topVal) * 100) : 0
            return (
              <div key={rep.id}
                className={`relative rounded-2xl border p-4 ${medal ? medal.cardClass : 'border-gray-200 bg-white'}`}>
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
                  <div className="flex flex-col items-center shrink-0 w-9">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${medal ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
                      style={medal ? { background: medal.gradient } : {}}>
                      {rank}
                    </div>
                    <div className="mt-0.5">
                      <RankMovement current={rank} prior={priorRankByRepId[rep.id] ?? null} />
                    </div>
                  </div>
                  <Avatar name={rep.name} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 text-sm truncate flex items-center gap-1.5">
                      {rep.name}
                      {rep.streakDays >= 2 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 text-[10px] font-bold">
                          <Flame className="w-3 h-3" /> {rep.streakDays}
                        </span>
                      )}
                      {rep.isPR && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-bold">
                          <Award className="w-3 h-3" /> PR
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {rep.bookings} booked · {closeRate}% close
                      {!redact && rep.revenue > 0 ? ` · $${formatCompact(rep.revenue)}` : ''}
                    </p>
                  </div>
                  {/* Primary right-side metric is now the count KPI
                      (appointments / estimates) — the headline number a setter
                      manager actually cares about. Revenue moves to the sub-
                      line above so it's still visible without dominating. */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-gray-900 tabular-nums">{apt}</p>
                    <p className="text-xs text-gray-400 lowercase">{countLabel}</p>
                  </div>
                </div>
                {/* Pace bar — % of leader on the active sort metric. */}
                {topVal > 0 && (
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pacePct}%`, background: BRAND_GREEN }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-gray-100">
                  <MicroStat label="Doors"   value={rep.doors}         />
                  <MicroStat label="Convos"  value={rep.conversations} />
                  <MicroStat label="Booked"  value={rep.bookings}      />
                  <MicroStat label="$/Door"  value={redact ? '—' : (rep.doors > 0 ? `$${revPerDoor.toFixed(0)}` : '$0')} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Skinny team-totals strip. One-row headline that sits above the list so
// screenshots always include a collective stat the manager can broadcast.
// Leads with the count metric (appointments / estimates) — that's the KPI
// for setter-driven teams. Revenue is the rightmost slot and gets muted when
// the manager is in "Hide $" mode.
function TeamTotalsStrip({ team, closeRate, redact, periodLabel, repCount, countLabel = 'Estimates' }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3 md:p-4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-3.5 h-3.5 text-slate-500" />
        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Team total · {periodLabel} · {repCount} rep{repCount !== 1 ? 's' : ''}</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <TeamStat label={countLabel} value={team.estimates} />
        <TeamStat label="Booked"     value={team.bookings} />
        <TeamStat label="Doors"      value={team.doors} />
        <TeamStat label={redact ? 'Close %' : 'Revenue'}
          value={redact ? `${closeRate}%` : `$${formatCompact(team.revenue)}`} />
      </div>
    </section>
  )
}
function TeamStat({ label, value, muted }) {
  return (
    <div>
      <p className={`text-lg md:text-xl font-extrabold leading-tight ${muted ? 'text-gray-300' : 'text-slate-900'}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
    </div>
  )
}

// ─── SVG share-card builder ─────────────────────────────────────────────────
// Hand-rolled SVG so we don't need to ship html-to-image / html2canvas. Renders
// a 1080-wide portrait card sized for Slack / iMessage / story shares. The
// caller serializes this to a Blob, draws it onto a Canvas, exports a PNG.
function buildLeaderboardShareSvg({ sorted, periodLabel, team, teamCloseRate, redact, countLabel = 'Estimates' }) {
  const W = 1080
  const ROW_H = 130
  const HEAD_H = 380
  const top = sorted.slice(0, Math.min(5, sorted.length))
  const H = HEAD_H + ROW_H * top.length + 90

  const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  const medals = ['#F5C542', '#9AA5B3', '#D99363']

  const rowsSvg = top.map((rep, i) => {
    const y = HEAD_H + i * ROW_H
    const cr = rep.conversations > 0 ? ((rep.bookings / rep.conversations) * 100).toFixed(0) : '0'
    const fill = colorForName(rep.name)
    const medal = medals[i]
    // Right-side headline is the count metric (appointments / estimates);
    // revenue moves into the sub-line so it's still visible without taking
    // the lead position.
    const apt = Math.max(rep.estimates || 0, rep.bookings || 0)
    const revBit = redact ? '' : (rep.revenue > 0 ? ` · $${formatCompact(rep.revenue)}` : '')
    return `
      <g transform="translate(40, ${y})">
        <rect x="0" y="0" rx="20" ry="20" width="${W - 80}" height="${ROW_H - 16}" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1" />
        <circle cx="46" cy="${(ROW_H - 16) / 2}" r="22" fill="${medal || '#F3F4F6'}" />
        <text x="46" y="${(ROW_H - 16) / 2 + 8}" font-family="system-ui, -apple-system, Inter, Arial" font-size="22" font-weight="800" fill="${medal ? '#FFFFFF' : '#374151'}" text-anchor="middle">${i + 1}</text>
        <circle cx="110" cy="${(ROW_H - 16) / 2}" r="26" fill="${fill}" />
        <text x="110" y="${(ROW_H - 16) / 2 + 9}" font-family="system-ui, -apple-system, Inter, Arial" font-size="22" font-weight="800" fill="#FFFFFF" text-anchor="middle">${esc(initialsFor(rep.name))}</text>
        <text x="158" y="${(ROW_H - 16) / 2 - 4}" font-family="system-ui, -apple-system, Inter, Arial" font-size="28" font-weight="800" fill="#0F172A">${esc(rep.name)}</text>
        <text x="158" y="${(ROW_H - 16) / 2 + 26}" font-family="system-ui, -apple-system, Inter, Arial" font-size="18" fill="#64748B">${rep.bookings} booked · ${rep.doors} doors · ${cr}% close${revBit}${rep.streakDays >= 2 ? ` · 🔥${rep.streakDays}` : ''}${rep.isPR ? ' · ⭐PR' : ''}</text>
        <text x="${W - 120}" y="${(ROW_H - 16) / 2 - 2}" font-family="system-ui, -apple-system, Inter, Arial" font-size="38" font-weight="900" fill="#0F172A" text-anchor="end">${apt}</text>
        <text x="${W - 120}" y="${(ROW_H - 16) / 2 + 26}" font-family="system-ui, -apple-system, Inter, Arial" font-size="14" font-weight="700" fill="#64748B" text-anchor="end">${esc(countLabel.toUpperCase())}</text>
      </g>`
  }).join('')

  // Team total tiles — appointments leads, revenue moves to last and is
  // hidden when redacted (the close % takes its slot in that mode).
  const tiles = redact
    ? [
        { l: countLabel.toUpperCase(), v: String(team.estimates) },
        { l: 'BOOKED', v: String(team.bookings) },
        { l: 'DOORS',  v: String(team.doors) },
        { l: 'CLOSE %', v: `${teamCloseRate}%` },
      ]
    : [
        { l: countLabel.toUpperCase(), v: String(team.estimates) },
        { l: 'BOOKED',  v: String(team.bookings) },
        { l: 'DOORS',   v: String(team.doors) },
        { l: 'REVENUE', v: `$${formatCompact(team.revenue)}` },
      ]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0F2C75" />
        <stop offset="100%" stop-color="#1B4FCC" />
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#F8FAFC" />
    <rect width="${W}" height="${HEAD_H - 20}" fill="url(#bg)" />
    <text x="60" y="80" font-family="system-ui, -apple-system, Inter, Arial" font-size="28" font-weight="700" fill="#FFFFFF" opacity="0.85">🏆 KnockIQ Leaderboard</text>
    <text x="60" y="150" font-family="system-ui, -apple-system, Inter, Arial" font-size="56" font-weight="900" fill="#FFFFFF">${esc(periodLabel)}</text>

    <g transform="translate(60, 200)">
      <rect width="${W - 120}" height="140" rx="20" fill="#FFFFFF" />
      <g font-family="system-ui, -apple-system, Inter, Arial">
        ${tiles.map((t, i) => `
          <g transform="translate(${40 + i * 240}, 40)">
            <text font-size="14" fill="#64748B" font-weight="700">${esc(t.l)}</text>
            <text y="42" font-size="36" font-weight="900" fill="#0F172A">${esc(t.v)}</text>
          </g>`).join('')}
      </g>
    </g>

    ${rowsSvg}

    <text x="${W / 2}" y="${H - 30}" font-family="system-ui, -apple-system, Inter, Arial" font-size="14" fill="#94A3B8" text-anchor="middle">KnockIQ · ${esc(new Date().toLocaleDateString())}</text>
  </svg>`
}

// ─── Shared sub-components ────────────────────────────────────────────────────
// KPI card + sparkline primitives (RichStatCard, MiniSparkArea, MiniSparkBars,
// RadialGauge, TrendChip) now live in ../components/StatSparkCards.jsx so the
// rep-side home can share the exact same look. Imports at the top of this file.

// Revenue bar chart — green "booked" bars over the period the manager has
// selected. The series is either daily or monthly depending on `bucketUnit`:
//
//   bucketUnit === 'day'   → one bar per calendar day (today/week/month views)
//   bucketUnit === 'month' → one bar per calendar month (all-time view)
//
// The rendering is shape-agnostic — bars, hover column, and tooltip behave
// identically; only the X-axis label format and the card title/subtitle
// shift to match the unit. Hovering still highlights the bar under the
// cursor and floats a tooltip with the bucket's date + booked revenue.
function DailyRevenueChart({ series = [], bucketUnit = 'day' }) {
  const hostRef = useRef(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  if (!series.length) return null
  const isMonthly = bucketUnit === 'month'
  const w = 320, h = 200
  const padL = 30, padR = 8, padT = 12, padB = 28
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  // Scale on combined revenue to reserve headroom for the grey "estimate" cap
  // once we track it separately. For now grey === booked (no estimate $$ yet).
  const maxRev = Math.max(1, ...series.map((d) => d.revenue))
  const slot = innerW / series.length
  const barW = Math.min(Math.max(slot * 0.55, 4), 28)

  const yAt = (val) => padT + innerH - (val / maxRev) * innerH
  const yTicks = [0, maxRev / 2, maxRev]

  // Snap mouse-x to the nearest bucket column. We use innerW (not the full
  // viewBox width) because the bars live inside padL..padR.
  const onMove = (e) => {
    if (!hostRef.current) return
    const rect = hostRef.current.getBoundingClientRect()
    const xPct = (e.clientX - rect.left) / Math.max(rect.width, 1)
    const vx = xPct * w
    const i  = Math.floor((vx - padL) / slot)
    setHoverIdx(Math.max(0, Math.min(series.length - 1, i)))
  }
  const onLeave = () => setHoverIdx(null)

  const hovered = hoverIdx != null ? series[hoverIdx] : null
  const tipXPct = hovered ? ((padL + slot * hoverIdx + slot / 2) / w) * 100 : 0
  const flipRight = tipXPct > 65

  // Card title and subtitle adapt to the bucket unit so the chart never
  // claims "Daily" while showing months.
  const title    = isMonthly ? 'Monthly Revenue' : 'Daily Revenue'
  const subtitle = isMonthly
    ? `${series.length}-month view · hover for details`
    : `${series.length}-day view · hover for details`

  // X-axis label format and density. Daily series get the existing "M/d"
  // (or "EEE" for short series) treatment; monthly series get a compact
  // "MMM" so 12 months don't overflow the axis, with the year nudged in
  // every January / on the latest bar so the timeline is grounded.
  const labelText = (d, i) => {
    if (isMonthly) {
      const showYear = d.date.getMonth() === 0 || i === series.length - 1
      return showYear ? format(d.date, "MMM ''yy") : format(d.date, 'MMM')
    }
    return format(d.date, series.length > 10 ? 'M/d' : 'EEE')
  }
  // Tooltip format — month buckets read "June 2026", day buckets keep
  // "Monday, Jun 2".
  const tooltipDate = (date) =>
    isMonthly ? format(date, 'MMMM yyyy') : format(date, 'EEEE, MMM d')

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#7ac943' }} />Booked</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#cbd5e1' }} />Estimates</span>
        </div>
      </div>
      <div
        ref={hostRef}
        className="relative"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto aspect-[8/5] block">
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
          {/* Hover column highlight */}
          {hoverIdx != null && (
            <rect
              x={padL + slot * hoverIdx}
              y={padT}
              width={slot}
              height={innerH}
              fill="#0f172a"
              opacity="0.04"
            />
          )}
          {/* Bars */}
          <g>
            {series.map((d, i) => {
              const cx = padL + slot * i + slot / 2
              const x  = cx - barW / 2
              const bookedH = Math.max((d.revenue / maxRev) * innerH, d.revenue > 0 ? 2 : 0)
              const bookedY = padT + innerH - bookedH
              const isHovered = i === hoverIdx
              return (
                <g key={i}>
                  {d.revenue > 0 && (
                    <rect
                      x={x} y={bookedY} width={barW} height={bookedH} rx="3"
                      fill={isHovered ? '#5ea636' : '#7ac943'}
                    />
                  )}
                </g>
              )
            })}
          </g>
          {/* X labels (every-Nth so they don't collide; the last label is
             always rendered so the timeline is anchored to "now"). */}
          <g fontSize="10" fill="#64748b" textAnchor="middle" fontWeight="600">
            {series.map((d, i) => {
              const cx = padL + slot * i + slot / 2
              const step = Math.ceil(series.length / 7)
              if (i % step !== 0 && i !== series.length - 1) return null
              return <text key={i} x={cx} y={h - 8}>{labelText(d, i)}</text>
            })}
          </g>
        </svg>
        {hovered && (
          <div
            className="absolute z-20 pointer-events-none whitespace-nowrap rounded-md bg-gray-900 text-white text-[11px] leading-tight font-medium px-2 py-1.5 shadow-lg"
            style={{
              left:  flipRight ? undefined : `${tipXPct}%`,
              right: flipRight ? `${100 - tipXPct}%` : undefined,
              top: 0,
              transform: flipRight ? 'translateY(-4px)' : 'translate(-50%, -4px)',
            }}
          >
            <div className="text-gray-300">{tooltipDate(hovered.date)}</div>
            <div className="font-bold">${formatCompact(hovered.revenue)} booked</div>
            <div className="text-gray-400 text-[10px]">
              {hovered.bookings} {hovered.bookings === 1 ? 'job' : 'jobs'} · {hovered.doors} doors
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Rep Rankings (Reps tab) ──────────────────────────────────────────────────
// Toggleable leaderboard that lives at the top of the Reps tab. Visually
// matches the Overview's RepLeaderboard (rank chip → avatar → gradient bar
// + sub-stat line) but the metric powering the sort/bar normalization is
// switchable via the pill row below the title.
//
// Why a separate component instead of extending RepLeaderboard:
//   • Overview's leaderboard is intentionally fixed-revenue (it's the
//     "headline" card, not a comparison tool).
//   • The Reps-tab card is the comparison tool — different concern, so
//     keeping them decoupled makes future iteration (e.g. adding a 2nd
//     metric for stack-rank vs. baseline) safer.
//
// All metrics show every active rep (not just top 5) since this card *is*
// the comparison surface — managers expect to see the full bench when they
// flip to "Close Rate" looking for a sleeper.
const RANK_METRICS = [
  { id: 'revenue',        label: 'Revenue',     hint: 'Total $ booked',  format: (v) => `$${formatCompact(v)}`, precision: 0 },
  { id: 'doors',          label: 'Doors',       hint: 'Doors knocked',   format: (v) => v.toLocaleString(),     precision: 0 },
  { id: 'bookings',       label: 'Jobs',        hint: 'Jobs booked',     format: (v) => v.toLocaleString(),     precision: 0 },
  { id: 'estimates',      label: 'Estimates',   hint: 'Estimates req\'d',format: (v) => v.toLocaleString(),     precision: 0 },
  { id: 'closeRate',      label: 'Close %',     hint: 'Bookings / conversations',format: (v) => `${v.toFixed(1)}%`,     precision: 1 },
  { id: 'revenuePerDoor', label: 'Rev / Door',  hint: 'Revenue per door',format: (v) => `$${v.toFixed(2)}`,     precision: 2 },
  { id: 'revenuePerHour', label: 'Rev / Hour',  hint: 'Revenue per hour',format: (v) => `$${v.toFixed(0)}`,     precision: 0 },
  { id: 'doorsPerHour',   label: 'Doors / Hour',hint: 'Canvassing pace — doors knocked per hour',format: (v) => `${v.toFixed(1)}/h`, precision: 1 },
  { id: 'hours',          label: 'Hours',       hint: 'Hours canvassing',format: (v) => `${v.toFixed(1)}h`,     precision: 1 },
  { id: 'sessions',       label: 'Sessions',    hint: 'Total sessions',  format: (v) => v.toLocaleString(),     precision: 0 },
]

function RepRankings({ repStats = [], onOpenRep }) {
  const [metricId, setMetricId] = useState('revenue')
  const metric = RANK_METRICS.find((m) => m.id === metricId) || RANK_METRICS[0]

  if (!repStats.length) {
    return (
      <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
        <p className="text-sm font-semibold text-gray-900 mb-1">Performance Rankings</p>
        <p className="text-xs text-gray-500">No rep activity in this period yet — rankings will appear once reps log sessions.</p>
      </section>
    )
  }

  // Sort by the selected metric, descending. We work off a copy so the
  // parent's repStats (sorted by revenue) doesn't get mutated when the
  // manager flips between metrics.
  const ranked = [...repStats].sort((a, b) => (b[metricId] || 0) - (a[metricId] || 0))
  const max    = Math.max(1, ...ranked.map((r) => r[metricId] || 0))

  const avatarColors = [
    'bg-lime-200 text-lime-800',
    'bg-blue-200 text-blue-800',
    'bg-teal-200 text-teal-800',
    'bg-violet-200 text-violet-800',
    'bg-orange-200 text-orange-800',
  ]

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
      {/* Header: title + selected-metric caption (mirrors RepLeaderboard) */}
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Performance Rankings</p>
        <p className="text-[11px] text-gray-500">By {metric.label.toLowerCase()}</p>
      </div>

      {/* Metric toggle pills — horizontally scrollable on narrow screens so
         all 9 fit without wrapping. Same slate-track / white-pill look as
         the SegmentedControl up in the filter bar. */}
      <div
        role="tablist"
        aria-label="Ranking metric"
        className="inline-flex max-w-full overflow-x-auto whitespace-nowrap rounded-xl bg-slate-100 p-1 mb-4 [scrollbar-width:thin]"
      >
        {RANK_METRICS.map((m) => {
          const active = m.id === metricId
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={m.hint}
              onClick={() => setMetricId(m.id)}
              className={
                'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 ' +
                (active
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900')
              }
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {/* Ranking rows — full bench (not top 5) so this card is a real
         comparison surface across the whole team. Layout: rank chip →
         avatar → name (left) + value (right) sitting above a normalized
         gradient bar. Mirrors the overview RepLeaderboard structure but
         re-sorts whenever metricId changes. */}
      <ul className="space-y-3">
        {ranked.map((r, i) => {
          const val = r[metricId] || 0
          const pct = (val / max) * 100
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onOpenRep?.(r.id)}
                className="w-full text-left rounded-lg -mx-1 px-1 py-1 hover:bg-slate-50 transition-colors"
                aria-label={`Open ${r.name} details`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-extrabold text-gray-400">{i + 1}</span>
                  <div className={`w-8 h-8 rounded-full font-bold text-xs grid place-items-center shrink-0 ${avatarColors[i % avatarColors.length]}`}>
                    {repInitials(r.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-3">
                      <p className="text-sm font-semibold text-gray-900 truncate">{r.name}</p>
                      <p className="text-sm font-extrabold text-gray-900 tabular-nums shrink-0">{metric.format(val)}</p>
                    </div>
                    <div className="relative h-2 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                            style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#7ac943,#2757d7)' }} />
                    </div>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Rep Leaderboard — sorted by revenue, gradient bar normalized to top rep.
// The palette cycles through 5 pastel avatar colors so it matches the
// mockup feel without needing per-rep color meta.
function RepLeaderboard({ repStats = [] }) {
  // useNavigate so each leaderboard row can route into RepDetail
  // (/manager/rep/:repId) — same destination the Reps tab uses, so a
  // manager can drill straight into a rep's home-page view from the
  // Overview without bouncing through the rep list.
  const navigate = useNavigate()
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
        <p className="text-[11px] text-gray-500">By revenue · tap a rep</p>
      </div>
      <ul className="space-y-1">
        {top.map((r, i) => {
          const pct = (r.revenue / max) * 100
          const close = r.conversations > 0 ? ((r.bookings / r.conversations) * 100).toFixed(1) : '0'
          return (
            <li key={r.id}>
              {/* Whole row is the hit-target — rank chip, avatar, name,
                 bar, and stats all open the same RepDetail. The name
                 underlines on hover/focus as the explicit affordance,
                 and the row gets a soft slate wash so it advertises
                 itself before the first click. */}
              <button
                type="button"
                onClick={() => navigate(`/manager/rep/${r.id}`)}
                aria-label={`Open ${r.name}'s detail view`}
                title={`View ${r.name}`}
                className="group block w-full text-left rounded-xl -mx-2 px-2 py-2 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-extrabold text-gray-400">{i + 1}</span>
                  <div className={`w-8 h-8 rounded-full font-bold text-xs grid place-items-center ${avatarColors[i % avatarColors.length]}`}>
                    {repInitials(r.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {r.name}
                      </p>
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
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Overview bottom-row cards ────────────────────────────────────────────────
// All four follow the same shell: bg-white rounded-2xl border + 4–5 padding,
// header row (title + subtitle), then the card-specific content. Kept as
// peers so the 2×2 grid in OverviewTab can compose them in any order without
// the cards knowing about each other.

// Recent Sessions — the original "look-back" list, now wrapped in a card
// shell so it sits cleanly next to the new cards in the half-width grid.
// Trimmed to 8 rows (down from 10) so its visual height roughly matches
// the Open Estimates card next to it.
function RecentSessionsCard({ sessions = [], onOpen, countLabel = 'estimates' }) {
  const visible = sessions.slice(0, 8)
  // For appointment-setter orgs the per-session "estimates" count is the
  // primary signal — many setters never see revenue land on their session
  // because the closer books the job later. We surface both: revenue
  // stays the top-right number for continuity, and the secondary line
  // shows the count using the org-configured noun. Normalize to lower
  // since callers pass either "Estimates"/"Appointments" (capitalized,
  // display style) or the raw lowercase org setting.
  const noun = String(countLabel || 'estimates').toLowerCase() === 'appointments' ? 'appt' : 'est'
  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Recent Sessions</p>
        <p className="text-[11px] text-gray-500">Latest activity</p>
      </div>
      <ul className="space-y-2">
        {visible.map((s) => {
          const countN  = s.estimates || 0
          const doorsN  = s.doors_knocked || 0
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen?.(s.id)}
                className="w-full text-left rounded-xl px-3 py-2.5 border border-gray-100 hover:bg-slate-50 hover:border-gray-200 transition-colors"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">{s.users?.full_name || 'Rep'}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(s.started_at), 'EEE MMM d, h:mm a')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <p className="font-bold text-gray-900 text-sm">${(s.revenue_booked || 0).toFixed(0)}</p>
                      <p className="text-xs text-gray-400">
                        {countN} {countN === 1 ? noun : noun + 's'} · {doorsN} doors
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Goal Tracker — pace-vs-target for the period currently filtered on the
// overview.
//
// Period-goal sourcing (in priority order):
//   1. For the month view, use org.monthly_goal_value when the manager
//      has set one. This is the most accurate source because it accounts
//      for team size and how often the team actually canvasses — facts
//      the system can't infer reliably from a per-rep daily target.
//   2. Otherwise, fall back to daily_goal_value × periodDays. This is a
//      rough heuristic that assumes one rep canvassing every day, so it
//      tends to overshoot for solo orgs and teams that don't work daily.
//      We surface the source ("manager-set" vs "auto") inline so the
//      manager knows when to override it.
//
// Supports BOTH goal types the org settings expose:
//   • revenue → headline = totalRevenue, formatted as $X.Xk
//   • count   → headline = totalEstimates, formatted as integer + plural
//               noun (estimates / appointments — driven by count_goal_label)
//
// The status pill ("on pace" / "behind" / "ahead") is driven by whether
// the rate-to-date is keeping up with the *effective* daily goal (period
// goal ÷ period days) — not just whether the period total has been hit —
// so a team early in the month sees something meaningful instead of
// always reading "behind" until the end.
function GoalTrackerCard({
  totalRevenue = 0, totalEstimates = 0, countLabel = 'Estimates',
  sessions = [], org = null, dateRange = 'month',
}) {
  // Days in the selected filter window — mirrors the math driving the
  // KPI sparklines so a "month" view here lines up with the cards above.
  const periodDays =
    dateRange === 'today' ? 1  :
    dateRange === 'week'  ? 7  :
    dateRange === 'month' ? 30 :
    /* all */               null

  // Number of *distinct* days the team has actually canvassed within the
  // period. We elapse based on activity, not the wall clock — a brand-new
  // org on day 3 of the month with 2 sessions logged shouldn't be told it
  // needs to make up 27 days of pace it never had.
  const activeDayKeys = new Set()
  for (const s of sessions) {
    if (!s.started_at) continue
    activeDayKeys.add(format(startOfDay(new Date(s.started_at)), 'yyyy-MM-dd'))
  }
  const daysElapsed = Math.max(activeDayKeys.size, 0)

  const goalType   = org?.daily_goal_type  || 'revenue'
  const dailyGoal  = Number(org?.daily_goal_value) || 0
  // Manager-set monthly override. Only applies to the month view because
  // the number's stated as a monthly figure — using it as the week or
  // today target would be wrong. null/0 means "no override".
  const monthlyOverride =
    dateRange === 'month' && Number(org?.monthly_goal_value) > 0
      ? Number(org.monthly_goal_value)
      : null

  // Per-goal-type plumbing. Everything downstream branches on `isRevenue`
  // through these formatters and the `actual` value — no `if (revenue) ...
  // else ...` blocks in the render. Keeps the two code paths in sync.
  const isRevenue  = goalType === 'revenue'
  const unitNoun   = isRevenue
    ? null
    : (countLabel || 'estimates').toLowerCase()
  const pluralNoun = (n) => {
    if (isRevenue) return null
    if (n === 1) {
      // "estimates" → "estimate", "appointments" → "appointment"
      return unitNoun.replace(/s$/, '')
    }
    return unitNoun
  }
  const actual     = isRevenue ? totalRevenue : totalEstimates
  // Formatters: revenue uses compact $ (e.g. "$58.6k"); counts use integers
  // since 4–60 estimates a day shouldn't be lossy-formatted.
  const fmtTotal   = (v) => isRevenue ? `$${formatCompact(v)}` : Math.round(v).toLocaleString()
  // Per-day formatter — same idea but with a "/day" suffix to mirror the
  // revenue version. We round to 1 decimal for low-count cases so a team
  // averaging 2.3 estimates/day doesn't get crushed down to "2".
  const fmtPerDay  = (v) => {
    if (v == null) return '—'
    if (isRevenue) return `$${formatCompact(v)}`
    // Show one decimal when small (< 10) so 2.3 stays readable; otherwise round.
    if (v < 10) return v.toFixed(1)
    return Math.round(v).toLocaleString()
  }

  // Bail-out: only "all time" view (no fixed window) and missing goal
  // config kick us out. We no longer fall through for count goals.
  // If a manager-set monthly override exists, we don't require dailyGoal
  // to render — the override stands on its own.
  if ((!dailyGoal && !monthlyOverride) || periodDays == null) {
    return (
      <section className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4 md:mb-5">
          <p className="text-gray-800 font-semibold text-base md:text-lg flex items-center gap-2">
            <Target className="w-5 h-5 text-gray-400" /> Goal Tracker
          </p>
        </div>
        <div className="py-6 text-center">
          <Target className="w-7 h-7 mx-auto mb-2 text-gray-300" />
          {periodDays == null ? (
            <>
              <p className="text-sm text-gray-500">Pick a fixed period to see pace.</p>
              <p className="text-xs text-gray-400 mt-0.5">"All time" doesn't have a target.</p>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500">No daily goal set.</p>
              <p className="text-xs text-gray-400 mt-0.5">Set one under Settings → Daily Goal.</p>
            </>
          )}
        </div>
      </section>
    )
  }

  // Period goal: manager-set monthly value when present (month view only),
  // otherwise daily × periodDays. Track which source was used so we can
  // label it for the manager.
  const periodGoal    = monthlyOverride != null
    ? monthlyOverride
    : dailyGoal * periodDays
  const goalSource    = monthlyOverride != null ? 'manager' : 'auto'
  // Pace target: when the manager set a monthly number directly, the
  // per-day yardstick is goal ÷ days, NOT the per-rep daily goal — those
  // measure different things (team-wide vs. per-rep). Falls back to the
  // per-rep daily goal only when we're auto-calculating.
  const paceTarget    = monthlyOverride != null
    ? monthlyOverride / periodDays
    : dailyGoal
  const remainingDays = Math.max(periodDays - daysElapsed, 0)
  const pctOfGoal     = Math.min((actual / periodGoal) * 100, 999)
  const pctClamped    = Math.min(pctOfGoal, 100)
  const remainingGoal = Math.max(periodGoal - actual, 0)
  // Daily run-rate so far. If no days canvassed yet, leave null so we
  // don't show "0/day" as a current pace.
  const currentRate   = daysElapsed > 0 ? actual / daysElapsed : null
  // What the team needs to average over the remaining days to still hit
  // the period goal. If the period is over, this isn't actionable.
  const requiredRate  = remainingDays > 0 ? remainingGoal / remainingDays : null

  // Status framing — "ahead" when current pace ≥ pace target, "behind" when
  // below 90% of it, "on pace" in between. The 90% band keeps a team that's
  // a hair under target from getting whiplashed by the indicator.
  let status, statusColor
  if (currentRate == null) {
    status      = 'no data yet'
    statusColor = 'text-slate-600 bg-slate-100'
  } else if (currentRate >= paceTarget) {
    status      = actual >= periodGoal ? 'goal hit 🎉' : 'on pace'
    statusColor = 'text-green-700 bg-green-100'
  } else if (currentRate >= paceTarget * 0.9) {
    status      = 'on pace'
    statusColor = 'text-green-700 bg-green-100'
  } else {
    status      = 'behind'
    statusColor = 'text-amber-700 bg-amber-100'
  }
  if (remainingDays === 0 && actual < periodGoal) {
    status      = 'missed'
    statusColor = 'text-red-700 bg-red-100'
  }

  const periodLabelStr =
    dateRange === 'today' ? 'today' :
    dateRange === 'week'  ? 'this week (rolling 7d)' :
    /* month */              'this period (rolling 30d)'
  // Headline eyebrow — "Revenue today" vs. "Estimates today" — so the
  // big number always carries its own unit context.
  const metricLabel = isRevenue
    ? 'Revenue'
    : countLabel.charAt(0).toUpperCase() + countLabel.slice(1).toLowerCase()

  return (
    <section className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4 md:mb-5">
        <p className="text-gray-800 font-semibold text-base md:text-lg flex items-center gap-2">
          <Target className="w-5 h-5 text-gray-400" /> Goal Tracker
        </p>
        <p className={`text-xs md:text-sm font-semibold px-3 py-1 rounded-full ${statusColor}`}>
          {status}
        </p>
      </div>

      {/* Big number — total vs the period goal, sized to match the
         Bottleneck card's headline. Suffix carries the unit when the goal
         is count-based ("12 estimates of 60"). */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
          {metricLabel} {periodLabelStr}
        </p>
        <div className="flex items-baseline gap-2 mt-1 flex-wrap">
          <p className="text-3xl md:text-4xl font-extrabold text-gray-900 leading-none tabular-nums">
            {fmtTotal(actual)}
          </p>
          <p className="text-sm md:text-base text-gray-500 font-medium">
            of {fmtTotal(periodGoal)}
            {!isRevenue && <> {pluralNoun(periodGoal)}</>}
          </p>
        </div>
        <p className="text-xs md:text-sm text-gray-500 mt-1.5 tabular-nums">
          <span className="font-bold text-gray-700">{pctOfGoal.toFixed(0)}%</span> of period goal
        </p>
      </div>

      {/* Progress bar — clamped to 100% visually so an over-performing team
         doesn't get a bar that spills past the card, but the headline still
         shows the true %. */}
      <div className="mt-3.5 h-3.5 md:h-4 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pctClamped}%`,
            background: pctOfGoal >= 100
              ? 'linear-gradient(90deg,#059669,#7DC31E)'
              : 'linear-gradient(90deg,#7DC31E,#1B4FCC)',
          }}
        />
      </div>

      {/* Source line — tells the manager whether the period number came
         from their own monthly override or our auto-calculation. Helpful
         context when the % feels off so they know where to go fix it. */}
      <p className="text-[10px] text-gray-400 mt-1.5">
        {goalSource === 'manager'
          ? `Period goal set by you in Settings → Monthly Team Goal.`
          : `Auto-calc: ${fmtTotal(dailyGoal)}${!isRevenue ? ` ${pluralNoun(dailyGoal)}` : ''}/day × ${periodDays} days. Set a monthly goal in Settings for a more accurate target.`}
      </p>

      {/* Pace stats — three columns mirroring the Bottleneck card's chips
         so this row stays visually aligned across the 2-col grid. */}
      <div className="grid grid-cols-3 gap-2 mt-4 md:mt-5">
        <div className="rounded-lg px-2 py-2 border border-gray-200 bg-gray-50">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            {goalSource === 'manager' ? 'Pace target' : 'Daily goal'}
          </p>
          <p className="text-base font-extrabold text-gray-700 tabular-nums">
            {fmtPerDay(paceTarget)}
            <span className="text-[10px] font-medium text-gray-400">/day</span>
          </p>
        </div>
        <div className="rounded-lg px-2 py-2 border border-gray-200 bg-gray-50">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Current pace</p>
          <p className="text-base font-extrabold text-gray-700 tabular-nums">
            {fmtPerDay(currentRate)}
            <span className="text-[10px] font-medium text-gray-400">/day</span>
          </p>
        </div>
        <div className={`rounded-lg px-2 py-2 border ${requiredRate != null && currentRate != null && requiredRate > currentRate ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
          <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Needed</p>
          <p className={`text-base font-extrabold tabular-nums ${requiredRate != null && currentRate != null && requiredRate > currentRate ? 'text-amber-700' : 'text-gray-700'}`}>
            {requiredRate != null ? fmtPerDay(requiredRate) : actual >= periodGoal ? '✓' : '—'}
            {requiredRate != null && <span className="text-[10px] font-medium text-gray-400">/day</span>}
          </p>
        </div>
      </div>

      {/* Plain-English summary — translates the math into one sentence
         the manager can act on. Built off the same fields the chips use. */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 mt-4">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
          What this means
        </p>
        <p className="text-xs md:text-sm text-slate-700 leading-snug">
          {actual >= periodGoal ? (
            <>Goal hit — keep stacking. Anything past today builds the next-period buffer.</>
          ) : remainingDays === 0 ? (
            <>Period closed {fmtTotal(remainingGoal)}{!isRevenue && <> {pluralNoun(remainingGoal)}</>} short. Look at which days didn't run sessions.</>
          ) : daysElapsed === 0 ? (
            <>No active days yet. Target is {fmtPerDay(paceTarget)}{!isRevenue && <> {pluralNoun(paceTarget)}</>}/day over {periodDays} days.</>
          ) : (
            <>
              {currentRate >= paceTarget ? (
                <>Pace is above the {fmtPerDay(paceTarget)}{!isRevenue && <> {pluralNoun(paceTarget)}</>}/day target. Stay on it — {fmtTotal(remainingGoal)}{!isRevenue && <> {pluralNoun(remainingGoal)}</>} left across {remainingDays} day{remainingDays === 1 ? '' : 's'}.</>
              ) : (
                <>
                  Team needs{' '}
                  <span className="font-semibold text-gray-900">
                    {fmtPerDay(requiredRate)}{!isRevenue && <> {pluralNoun(requiredRate)}</>}/day
                  </span>{' '}
                  across the remaining {remainingDays} day{remainingDays === 1 ? '' : 's'} to hit {fmtTotal(periodGoal)}{!isRevenue && <> {pluralNoun(periodGoal)}</>}.
                </>
              )}
            </>
          )}
        </p>
      </div>

      {/* Suggestions — fills the bottom of the card with context-aware
          callouts. Behind: corrective actions quoting specific data.
          On pace: reinforcement + small optimization. Goal hit:
          recognition + buffer math + raise-the-bar nudge. See
          buildGoalSuggestions for the rules. */}
      <GoalSuggestionsBlock
        status={status}
        suggestions={buildGoalSuggestions({
          sessions, isRevenue, dailyGoal: paceTarget, periodGoal, periodDays,
          remainingDays, actual, currentRate, pluralNoun,
          fmtTotal, fmtPerDay,
        })}
      />
    </section>
  )
}

/**
 * Renders the suggestions list at the bottom of the GoalTrackerCard.
 * Stays empty if no suggestions fire — better to leave whitespace than
 * to invent generic filler.
 */
function GoalSuggestionsBlock({ status, suggestions }) {
  if (!suggestions || suggestions.length === 0) return null
  const heading =
    status === 'behind' || status === 'missed' ? 'Try this'  :
    status === 'goal hit 🎉'                  ? 'Wins'      :
                                                'Keep going'
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <p className="text-[10px] uppercase tracking-wide font-bold text-gray-400 mb-2">
        {heading}
      </p>
      <ul className="space-y-2">
        {suggestions.slice(0, 3).map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="text-[14px] leading-5 shrink-0" aria-hidden="true">{s.icon}</span>
            <p className="text-xs md:text-sm text-gray-700 leading-snug">
              <span className="font-semibold text-gray-900">{s.headline}</span>
              {s.detail && <span className="text-gray-600"> — {s.detail}</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Build a small ranked list of suggestions for the GoalTrackerCard.
 *
 * Rules are evaluated against the same sessions array the rest of the
 * card uses, so callouts cite real names + numbers from the team. Each
 * rule returns null if its preconditions aren't met (e.g. no clear
 * lagging rep, no day-of-week pattern); the dispatcher prunes nulls and
 * caps the list at 3 so the card never feels noisy.
 *
 * Mode selection mirrors the status pill: behind → corrective rules,
 * goal-hit → recognition + buffer math, on-pace → reinforcement + one
 * optimization. The pure helpers below (topRep, bestDay, etc.) are kept
 * separate so they're trivially testable and reusable.
 */
function buildGoalSuggestions(ctx) {
  const {
    sessions, isRevenue, dailyGoal, periodGoal, periodDays,
    remainingDays, actual, currentRate, pluralNoun,
    fmtTotal, fmtPerDay,
  } = ctx
  if (!sessions || sessions.length === 0) return []

  // Choose the metric we suggest against — for revenue goals everything
  // is dollars; for count goals it's estimates/appointments. Centralized
  // so a new rule doesn't have to re-derive this.
  const metricFn = (s) => isRevenue
    ? Number(s.revenue_booked || 0)
    : Number(s.estimates || 0)

  const status =
    actual >= periodGoal                          ? 'hit'      :
    currentRate != null && currentRate >= dailyGoal ? 'on_pace' :
    currentRate != null && currentRate >= dailyGoal * 0.9 ? 'on_pace' :
                                                    'behind'

  const out = []

  // ── BEHIND ──────────────────────────────────────────────────────────
  if (status === 'behind') {
    const lagging = laggingRep(sessions, metricFn)
    if (lagging) {
      out.push({
        icon: '🎯',
        headline: `${lagging.name} is at ${fmtPerDay(lagging.theirRate)}/session`,
        detail: `team avg ${fmtPerDay(lagging.teamRate)}/session — a 1:1 could unlock them`,
      })
    }
    const day = bestDayOfWeek(sessions, metricFn)
    if (day) {
      out.push({
        icon: '📅',
        headline: `${day.name}s are your strongest day`,
        detail: `${day.upliftPct.toFixed(0)}% above other weekdays — schedule extra sessions then`,
      })
    }
    const hood = topNeighborhood(sessions)
    if (hood) {
      out.push({
        icon: '🏘️',
        headline: `${hood.name} has ${hood.rpdMultiplier.toFixed(1)}× the revenue per door`,
        detail: `try concentrating reps there next session`,
      })
    }
    const convo = conversationBottleneck(sessions)
    if (convo && out.length < 3) {
      out.push({
        icon: '🚪',
        headline: `Only ${convo.pct.toFixed(0)}% of doors lead to a conversation`,
        detail: `door-opening is the lever — not closing`,
      })
    }
    const trend = recentTrendDip(sessions, metricFn)
    if (trend && out.length < 3) {
      out.push({
        icon: '📉',
        headline: `Last 3 days averaged ${fmtPerDay(trend.recent)}/session`,
        detail: `down from ${fmtPerDay(trend.prior)} — check rep availability`,
      })
    }
  }

  // ── GOAL HIT ────────────────────────────────────────────────────────
  if (status === 'hit') {
    const mvp = topRep(sessions, metricFn)
    if (mvp) {
      out.push({
        icon: '🏆',
        headline: `MVP: ${mvp.name}`,
        detail: `${fmtTotal(mvp.total)}${!isRevenue ? ` ${pluralNoun?.(mvp.total) || ''}` : ''} this period`,
      })
    }
    const buffer = actual - periodGoal
    if (buffer > 0 && currentRate) {
      const daysBanked = buffer / dailyGoal
      out.push({
        icon: '💰',
        headline: `${fmtTotal(buffer)}${!isRevenue ? ` ${pluralNoun?.(buffer) || ''}` : ''} over goal`,
        detail: `that's ~${daysBanked.toFixed(1)} day${daysBanked >= 1.5 ? 's' : ''} banked toward next period`,
      })
    }
    if (currentRate && currentRate >= dailyGoal * 1.15) {
      const suggested = Math.round(currentRate * 0.95 / 100) * 100
      out.push({
        icon: '⬆️',
        headline: 'Consider raising the daily goal',
        detail: `pace is ${((currentRate / dailyGoal - 1) * 100).toFixed(0)}% above target — try ${fmtTotal(suggested)}/day`,
      })
    }
    const hood = topNeighborhood(sessions)
    if (hood && out.length < 3) {
      out.push({
        icon: '🏘️',
        headline: `Strongest area: ${hood.name}`,
        detail: `${fmtTotal(hood.rpd)}/door — repeat that pattern`,
      })
    }
  }

  // ── ON PACE ─────────────────────────────────────────────────────────
  if (status === 'on_pace') {
    const mvp = topRep(sessions, metricFn)
    if (mvp) {
      out.push({
        icon: '⭐',
        headline: `${mvp.name} is anchoring this`,
        detail: `${fmtTotal(mvp.total)}${!isRevenue ? ` ${pluralNoun?.(mvp.total) || ''}` : ''} so far`,
      })
    }
    if (currentRate && remainingDays > 0) {
      const projected = actual + (currentRate * remainingDays)
      const overPct = ((projected / periodGoal - 1) * 100)
      if (projected >= periodGoal) {
        out.push({
          icon: '📈',
          headline: `On track to close at ${fmtTotal(projected)}`,
          detail: `${overPct >= 0 ? '+' : ''}${overPct.toFixed(0)}% vs period goal`,
        })
      }
    }
    const day = bestDayOfWeek(sessions, metricFn)
    if (day && out.length < 3) {
      out.push({
        icon: '📅',
        headline: `${day.name}s are gold`,
        detail: `${day.upliftPct.toFixed(0)}% above other weekdays`,
      })
    }
  }

  return out
}

/* ── Pure helpers for the rules above ─────────────────────────────────── */

// Aggregate sessions by rep name. Returns { name, total } records.
function aggregateByRep(sessions, metricFn) {
  const by = {}
  for (const s of sessions) {
    const name = s.users?.full_name || 'Unknown'
    by[name] = (by[name] || 0) + metricFn(s)
  }
  return Object.entries(by).map(([name, total]) => ({ name, total }))
}

function topRep(sessions, metricFn) {
  const reps = aggregateByRep(sessions, metricFn)
  if (reps.length === 0) return null
  reps.sort((a, b) => b.total - a.total)
  if (reps[0].total === 0) return null
  return reps[0]
}

// Identify a lagging rep: lowest performer whose RATE is < 50% of team avg
// AND who has at least 3 sessions (so we don't slander a brand-new hire).
function laggingRep(sessions, metricFn) {
  const counts = {}
  for (const s of sessions) {
    const name = s.users?.full_name || 'Unknown'
    counts[name] = (counts[name] || 0) + 1
  }
  const reps = aggregateByRep(sessions, metricFn).map((r) => ({
    ...r,
    sessions: counts[r.name] || 0,
    rate:     (counts[r.name] ? r.total / counts[r.name] : 0),
  })).filter((r) => r.sessions >= 3)
  if (reps.length < 2) return null
  const teamRate = reps.reduce((a, r) => a + r.rate, 0) / reps.length
  reps.sort((a, b) => a.rate - b.rate)
  const lo = reps[0]
  if (teamRate <= 0) return null
  if (lo.rate >= teamRate * 0.5) return null
  return { name: lo.name, theirRate: lo.rate, teamRate }
}

// Best day of week by avg per-session metric. Requires at least 2 distinct
// weekdays represented + a 15%+ uplift for the top day vs the rest.
function bestDayOfWeek(sessions, metricFn) {
  const byDay = {} // dayName → { total, count }
  for (const s of sessions) {
    if (!s.started_at) continue
    const d = new Date(s.started_at)
    const name = d.toLocaleDateString('en-US', { weekday: 'long' })
    if (!byDay[name]) byDay[name] = { total: 0, count: 0 }
    byDay[name].total += metricFn(s)
    byDay[name].count += 1
  }
  const arr = Object.entries(byDay)
    .map(([name, v]) => ({ name, rate: v.count ? v.total / v.count : 0 }))
    .filter((x) => x.rate > 0)
  if (arr.length < 2) return null
  arr.sort((a, b) => b.rate - a.rate)
  const top = arr[0]
  const restRate = arr.slice(1).reduce((a, x) => a + x.rate, 0) / (arr.length - 1)
  if (restRate <= 0) return null
  const upliftPct = (top.rate / restRate - 1) * 100
  if (upliftPct < 15) return null
  return { name: top.name, upliftPct, rate: top.rate, restRate }
}

// Top neighborhood by revenue-per-door. Requires at least 2 areas with
// ≥ 20 doors each and a 50%+ RPD gap to surface.
function topNeighborhood(sessions) {
  const by = {} // name → { revenue, doors }
  for (const s of sessions) {
    const name = (s.neighborhood || '').trim() || null
    if (!name) continue
    if (!by[name]) by[name] = { revenue: 0, doors: 0 }
    by[name].revenue += Number(s.revenue_booked || 0)
    by[name].doors   += Number(s.doors_knocked  || 0)
  }
  const arr = Object.entries(by)
    .map(([name, v]) => ({ name, rpd: v.doors ? v.revenue / v.doors : 0, doors: v.doors }))
    .filter((x) => x.doors >= 20)
  if (arr.length < 2) return null
  arr.sort((a, b) => b.rpd - a.rpd)
  const top  = arr[0]
  const restRpd = arr.slice(1).reduce((a, x) => a + x.rpd, 0) / (arr.length - 1)
  if (restRpd <= 0 || top.rpd < restRpd * 1.5) return null
  return { name: top.name, rpd: top.rpd, rpdMultiplier: top.rpd / restRpd }
}

// Door → conversation conversion rate across the period. Returns the pct
// only when it's below 12% (otherwise it's not the bottleneck).
function conversationBottleneck(sessions) {
  let doors = 0, conv = 0
  for (const s of sessions) {
    doors += Number(s.doors_knocked || 0)
    conv  += Number(s.conversations  || 0)
  }
  if (doors < 50) return null
  const pct = (conv / doors) * 100
  if (pct >= 12) return null
  return { pct, doors, conv }
}

// Last-3-days avg per session vs the trailing 7 days before that. Surfaces
// only if the recent run is 25%+ below prior.
function recentTrendDip(sessions, metricFn) {
  if (sessions.length < 6) return null
  const sorted = [...sessions].sort((a, b) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  )
  const now = Date.now()
  const recent = sorted.filter((s) =>
    (now - new Date(s.started_at).getTime()) / 86_400_000 <= 3
  )
  const prior = sorted.filter((s) => {
    const days = (now - new Date(s.started_at).getTime()) / 86_400_000
    return days > 3 && days <= 10
  })
  if (recent.length < 2 || prior.length < 3) return null
  const recentRate = recent.reduce((a, s) => a + metricFn(s), 0) / recent.length
  const priorRate  = prior.reduce((a, s) => a + metricFn(s), 0) / prior.length
  if (priorRate <= 0) return null
  if (recentRate >= priorRate * 0.75) return null
  return { recent: recentRate, prior: priorRate }
}

// Top Areas — groups sessions by their `neighborhood` text field and ranks
// by revenue. Neighborhoods are user-entered at session start, so we treat
// blanks as "Open Territory" rather than dropping them (better to show "you have
// $14k from sessions with no area tagged" than to silently hide it).
//
// We show three stats per row — revenue, doors, and revenue-per-door —
// because the same neighborhood can rank #1 by gross revenue and still be
// a weak hunting ground per-door. RPD is the signal that tells a manager
// "send more reps here."
function TopAreasCard({ sessions = [], onJumpToTerritories }) {
  const buckets = {}
  for (const s of sessions) {
    const key = (s.neighborhood || '').trim() || 'Open Territory'
    if (!buckets[key]) buckets[key] = { name: key, revenue: 0, doors: 0, bookings: 0, sessions: 0 }
    buckets[key].revenue  += s.revenue_booked || 0
    buckets[key].doors    += s.doors_knocked  || 0
    buckets[key].bookings += s.bookings       || 0
    buckets[key].sessions += 1
  }
  const ranked = Object.values(buckets)
    .filter((b) => b.revenue > 0 || b.doors > 0)
    .sort((a, b) => b.revenue - a.revenue)
  const top = ranked.slice(0, 5)
  const max = Math.max(1, ...top.map((b) => b.revenue))

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-4 md:p-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Top Areas</p>
        <p className="text-[11px] text-gray-500">By revenue · tap a row</p>
      </div>
      {top.length === 0 ? (
        <div className="py-6 text-center">
          <MapPin className="w-6 h-6 mx-auto mb-2 text-gray-300" />
          <p className="text-xs text-gray-500">No neighborhood-tagged activity yet.</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Reps can tag the area when starting a session.</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {top.map((b, i) => {
            const pct = (b.revenue / max) * 100
            const rpd = b.doors > 0 ? b.revenue / b.doors : 0
            return (
              <li key={b.name}>
                {/* Whole row routes to the Territories tab — same affordance
                    pattern as Rep Leaderboard: slate hover wash for the cue,
                    no underline. The aria-label calls out the destination so
                    screen-reader users aren't surprised by the tab switch. */}
                <button
                  type="button"
                  onClick={() => onJumpToTerritories?.()}
                  aria-label={`Open Territories tab (from ${b.name})`}
                  title="View territories"
                  className="group block w-full text-left rounded-xl -mx-2 px-2 py-2 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-center text-xs font-extrabold text-gray-400">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">{b.name}</p>
                        <p className="text-sm font-extrabold text-gray-900 shrink-0">${formatCompact(b.revenue)}</p>
                      </div>
                      <div className="relative h-2 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#7ac943,#2757d7)' }}
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">
                        {b.doors} doors · {b.bookings} jobs · ${rpd.toFixed(0)}/door
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// Funnel Drop-Off — togglable view of all three funnel stages, with the
// auto-identified "biggest leak" called out but not the only thing the
// manager can act on. When drop-rates are close (e.g. 78% vs 75% vs 73%),
// naming one stage "the bottleneck" is misleading — the leak is everywhere.
// The toggle lets a manager browse coaching recommendations for each
// stage, and a "tight margins" disclaimer appears when the top two stages
// are within 10 pts of each other, so the framing is honest about
// ambiguity.
//
// We surface the CONVERSION rate (passed ÷ entered) rather than the drop
// rate so the number aligns with the Conversion Funnel above ("21% of
// doors" in the funnel ⇄ "21% advance" here). The drop is called out
// alongside so both framings are visible without dressing the headline
// in a misleading metric.
//
// `countLabel` mirrors the org's "estimates" vs "appointments" terminology
// so the card reads in the manager's preferred verbiage.
function ConversionBottleneckCard({ stats = {}, countLabel = 'Estimates' }) {
  const { doors = 0, conversations = 0, estimates = 0, bookings = 0 } = stats
  const estLabel = countLabel.toLowerCase()

  // Build stages in order. `entered` = pool that reached this stage,
  // `passed` = pool that advanced to the next stage. Conversion% =
  // passed/entered. Each stage carries its own coaching tip — the toggle
  // surfaces the tip for whichever stage the manager has selected.
  const stages = [
    {
      key:     'doors',
      from:    'Doors',
      to:      'Conversations',
      short:   'Door → Convo',
      entered: doors,
      passed:  conversations,
      tip:     'Reps are knocking but not getting people to talk. Reinforce opening lines and the "second knock" rule, and check whether they\'re hitting at the right times of day. Audit a few sessions where contact rate is below team average — the gap is usually pitch delivery, not territory quality.',
    },
    {
      key:     'convos',
      from:    'Conversations',
      to:      countLabel,
      short:   `Convo → ${countLabel.slice(0, 3)}.`,
      entered: conversations,
      passed:  estimates,
      tip:     `Reps are starting conversations but not landing ${estLabel}. Roleplay objection handling and tighten the value pitch — most ${estLabel} are won in the first 30 seconds. Listen in on a few live sessions; "I'm not interested" almost always means the opener didn't earn the next minute.`,
    },
    {
      key:     'estimates',
      from:    countLabel,
      to:      'Bookings',
      short:   `${countLabel.slice(0, 3)}. → Book`,
      entered: estimates,
      passed:  bookings,
      tip:     `${countLabel} aren't converting to booked jobs. Review the quoting flow with reps, check pricing competitiveness, and make sure follow-ups happen within 24 hrs. Pull the ${estLabel} that went cold and check whether the rep ever circled back — silent attrition is the usual cause.`,
    },
  ]

  // Only consider stages where someone actually reached the top of the
  // funnel — a stage with `entered = 0` has an undefined conversion rate.
  const evaluable = stages
    .map((s) => ({
      ...s,
      convPct: s.entered > 0 ? (s.passed / s.entered) * 100 : null,
      dropPct: s.entered > 0 ? (1 - s.passed / s.entered) * 100 : null,
    }))
    .filter((s) => s.convPct != null)

  // Auto-suggested = lowest pass-through % (= highest drop %). Tie-break
  // to the earlier stage (first match wins) since fixing an upstream leak
  // compounds downstream. The card no longer calls this "the bottleneck";
  // it's a starting point the manager can override via the toggle.
  let suggested = null
  for (const s of evaluable) {
    if (!suggested || s.convPct < suggested.convPct) suggested = s
  }

  // Margin between the worst and runner-up stages — drives the "tight
  // margins" disclaimer. If the gap is < 10 pts, the auto-suggestion is
  // fragile and we say so. The card still has a default selection, but
  // the manager is steered to look at all three.
  const sortedByDrop = [...evaluable].sort((a, b) => b.dropPct - a.dropPct)
  const tightMargins =
    sortedByDrop.length >= 2 &&
    Math.abs(sortedByDrop[0].dropPct - sortedByDrop[1].dropPct) < 10

  // Selected stage is local state — initialized to the auto-suggested key
  // but the manager can browse the others. We re-sync when the suggestion
  // itself changes (e.g. period filter changes, different stage now leads).
  const [selectedKey, setSelectedKey] = useState(suggested?.key || null)
  useEffect(() => {
    if (suggested && suggested.key !== selectedKey) {
      setSelectedKey(suggested.key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested?.key])

  const selected =
    evaluable.find((s) => s.key === selectedKey) || suggested

  return (
    <section className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4 md:mb-5">
        <p className="text-gray-800 font-semibold text-base md:text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-gray-400" /> Funnel Drop-Off
        </p>
        <p className="text-xs md:text-sm font-semibold text-gray-600 bg-gray-50 px-3 py-1 rounded-full">
          tap a stage
        </p>
      </div>
      {!selected ? (
        <div className="py-8 text-center">
          <AlertTriangle className="w-7 h-7 mx-auto mb-2 text-gray-300" />
          <p className="text-sm text-gray-500">Not enough activity to evaluate the funnel.</p>
          <p className="text-xs text-gray-400 mt-0.5">Need at least one door knocked.</p>
        </div>
      ) : (
        <div className="space-y-4 md:space-y-5">
          {/* Stage toggle — three chips, one per funnel stage. The selected
             chip gets a red wash (echoes "leak" framing); the auto-suggested
             stage gets a small "biggest" badge so the manager has a starting
             point but can override. Each chip always shows its conversion %
             so the relative weights are visible regardless of which one is
             open. */}
          <div
            role="tablist"
            aria-label="Funnel stage"
            className="grid grid-cols-3 gap-2"
          >
            {evaluable.map((s) => {
              const isSelected  = s.key === selected.key
              const isSuggested = s.key === suggested?.key
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setSelectedKey(s.key)}
                  className={
                    'relative rounded-lg px-2 py-2 border text-left transition-colors ' +
                    (isSelected
                      ? 'border-red-300 bg-red-50 ring-1 ring-red-200'
                      : 'border-gray-200 bg-gray-50 hover:bg-slate-100 hover:border-slate-300')
                  }
                >
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold truncate">
                    {s.short}
                  </p>
                  <p className={`text-base font-extrabold tabular-nums ${isSelected ? 'text-red-700' : 'text-gray-700'}`}>
                    {Math.round(s.convPct)}%
                  </p>
                  {isSuggested && (
                    <span
                      className="absolute -top-1.5 -right-1.5 text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-red-600 text-white shadow-sm"
                      title="Auto-flagged as the steepest drop in this period"
                    >
                      Biggest
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tight-margins disclaimer — only shows when the worst stage
             isn't meaningfully worse than the runner-up. Keeps the card
             honest: if all three are leaking at similar rates, naming one
             "the" bottleneck is misleading. */}
          {tightMargins && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 leading-snug">
              <span className="font-semibold">Tight margins.</span> The top two stages drop within 10 pts of each other — every stage matters this period.
            </p>
          )}

          {/* Headline — selected stage's CONVERSION rate (matches the
             Conversion Funnel above). The drop is spelled out below so
             the framing is explicit either way. */}
          <div>
            <p className="text-xs md:text-sm uppercase tracking-wide text-red-600 font-semibold">
              {selected.from} → {selected.to}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-3xl md:text-4xl font-extrabold text-gray-900 leading-none tabular-nums">
                {Math.round(selected.convPct)}%
              </p>
              <p className="text-sm md:text-base text-gray-500 font-medium">advance</p>
            </div>
            <p className="text-xs md:text-sm text-gray-500 mt-1.5">
              <span className="font-semibold text-red-600">▼ {Math.round(selected.dropPct)}% drop</span>
              {' · '}
              {(selected.entered - selected.passed).toLocaleString()} of {selected.entered.toLocaleString()} didn't advance
            </p>
          </div>

          {/* Coaching nudge — driven by the selected stage. Each stage has
             its own recommendation so toggling actually gives the manager
             something new to read. */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
              Suggested action · {selected.from} → {selected.to}
            </p>
            <p className="text-xs md:text-sm text-slate-700 leading-snug">{selected.tip}</p>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Overview helpers ────────────────────────────────────────────────────────
// How many days of history the overview's bar chart + sparklines should
// render for a given period filter. Today=1, week=7, month=30,
// all=derived from oldest session (capped so bars stay legible).
// Falls back to 7 if nothing matches.
function daysForRange(range, sessions = []) {
  const now = new Date()
  if (range === 'today') return 1
  if (range === 'week')  return 7
  if (range === 'month') return 30
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

// ─── Pill Dropdown ───────────────────────────────────────────────────────────
// Native <select> wearing the same slate-100 track + white-card pill
// aesthetic as SegmentedControl. Used for filters where the option set
// is too large to pillify (e.g. a team's rep list) but should still feel
// visually consistent with the adjacent segmented controls.
function PillDropdown({ label, value, onChange, options }) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 shrink-0">
          {label}
        </span>
      )}
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="appearance-none bg-white rounded-lg text-sm font-medium text-slate-900 pl-3 pr-9 py-1.5 ring-1 ring-slate-200 shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 8l4 4 4-4" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ─── Segmented Control ───────────────────────────────────────────────────────
// Small pill-group control used by the filter bar below the TabBar to pick a
// period (Daily/Weekly/Monthly/All time) and a rep (All Reps / individual).
// Styling intentionally matches the "Daily/Weekly/Monthly" toggle that the
// Overview tab has been using: a slate-100 track with a white-card pill for
// the active option. `scrollable` turns the track into a horizontal scroller
// so the rep selector can accommodate teams of arbitrary size on mobile.
function SegmentedControl({ label, value, onChange, options, scrollable = false }) {
  return (
    <div className={`flex items-center gap-2 ${scrollable ? 'min-w-0 lg:flex-1' : ''}`}>
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 shrink-0">
          {label}
        </span>
      )}
      <div
        role="tablist"
        aria-label={label}
        className={
          'inline-flex rounded-xl bg-slate-100 p-1 ' +
          (scrollable
            ? 'max-w-full overflow-x-auto whitespace-nowrap [scrollbar-width:thin] [-ms-overflow-style:none]'
            : '')
        }
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.value)}
              className={
                'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors shrink-0 ' +
                (active
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900')
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>
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
        className="flex overflow-x-auto scrollbar-hide max-w-7xl mx-auto w-full"
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
