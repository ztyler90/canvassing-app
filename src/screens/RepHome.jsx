import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  MapPin, DollarSign, Settings, Trophy, Play,
  TrendingUp, Users, Target, ChevronRight, Sparkles, LogOut,
  Map, Inbox, Flag,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import {
  startSession, getRepSessions, getActiveSession,
  updateSessionStats, getMyCommissionConfig, getSessionInteractions,
  getMyOrganization, getRepOutcomesForHour, signOut,
  getLeaderboardData, getLeaderboardRange, getOrgTerritoriesForRep,
} from '../lib/supabase.js'
import { requestGPSPermission } from '../lib/gps.js'
import { gpsTracker } from '../lib/gps.js'
import { DoorKnockDetector } from '../lib/doorKnock.js'
import { motionClassifier } from '../lib/motion.js'
import { dnkZones, pointInAnyZone, loadDnkZones } from '../lib/dnk.js'
import {
  computePeriodStats, computeConversion,
  computeXP, computeLevel, calcCommission, describeCommission,
  computeBestHour,
} from '../lib/repStats.js'
import {
  computeRankMovement, computeDrySpell, computePersonalBestCloseRate,
  computeCloseRateDiagnostic, computeLevelUpProximity, computeTeamPulse,
} from '../lib/callouts.js'
import RepCallouts from '../components/RepCallouts.jsx'
import {
  RichStatCard, MiniSparkArea, MiniSparkBars,
  formatCompact, computeTrend, groupSessionsByDay,
} from '../components/StatSparkCards.jsx'
import { differenceInCalendarDays, startOfWeek, startOfMonth } from 'date-fns'

const BRAND_BLUE = '#1B4FCC'  // KnockIQ blue
const BRAND_LIME = '#7DC31E'  // KnockIQ lime (accent)

// Fallback goal shape — used until the org row is loaded (and for orgs
// created before the daily-goal columns existed). Matches the default
// DB values: a $1,000 revenue target with "estimates" terminology.
const DEFAULT_GOAL = {
  daily_goal_type:  'revenue',
  daily_goal_value: 1000,
  count_goal_label: 'estimates',
}

// Map the rep's selected period tab → the number of calendar-day buckets
// the sparkline should render. Mirrors the manager's daysForRange helper
// but uses the rep-screen period vocabulary ('week' | 'month' | 'lifetime').
//
// Semantics:
//   week     → Monday-to-today, inclusive (1–7 days)
//   month    → 1st-of-month to today, inclusive (1–31 days)
//   lifetime → most recent 30 days of session history, capped so a long-
//              tenured rep's sparkline stays legible. If there are fewer
//              than 30 days between their first session and today, we use
//              that smaller number so we don't zero-fill empty prehistory.
//   fallback → 7
function daysForRepPeriod(period, sessions) {
  const now = new Date()
  if (period === 'week') {
    return Math.max(1, differenceInCalendarDays(now, startOfWeek(now, { weekStartsOn: 1 })) + 1)
  }
  if (period === 'month') {
    return Math.max(1, differenceInCalendarDays(now, startOfMonth(now)) + 1)
  }
  if (period === 'lifetime') {
    if (!sessions || sessions.length === 0) return 7
    const oldest = sessions.reduce((min, s) => {
      const t = new Date(s.started_at).getTime()
      return (!min || t < min) ? t : min
    }, null)
    if (!oldest) return 7
    const spanDays = differenceInCalendarDays(now, new Date(oldest)) + 1
    return Math.max(1, Math.min(30, spanDays))
  }
  return 7
}

export default function RepHome() {
  const { user }              = useAuth()
  const { state, dispatch, doorKnockRef } = useSession()
  const navigate = useNavigate()

  const [allSessions,   setAllSessions]   = useState([])
  const [loadingStart,  setLoadingStart]  = useState(false)
  const [gpsError,      setGpsError]      = useState('')
  const [commissionCfg, setCommissionCfg] = useState(null)
  const [goalCfg,       setGoalCfg]       = useState(DEFAULT_GOAL)
  const [period,        setPeriod]        = useState('week')  // 'week' | 'month' | 'lifetime'
  const [loadingData,   setLoadingData]   = useState(true)
  // The rep's best hour-of-day for closes, computed from their history.
  // Null until we've confirmed there's enough data for a credible nudge;
  // the card stays hidden in that case rather than showing noise.
  const [bestHour,      setBestHour]      = useState(null)
  // Three leaderboard slices powering the callouts. We load them lazily
  // alongside the main dashboard so a slow network doesn't delay the
  // Start-Canvassing CTA. Default to [] so compute helpers short-circuit
  // to null rather than throwing on undefined.
  const [boardToday,    setBoardToday]    = useState([])
  const [boardThisWeek, setBoardThisWeek] = useState([])
  const [boardLastWeek, setBoardLastWeek] = useState([])
  // "Next Stops" inbox — every territory in the rep's org with the
  // assigned-to-me flag, an interaction count, and the most-recent knock
  // date. Loaded independently of the main dashboard so a slow door-
  // history query can't delay the Start-Canvassing CTA.
  const [territoryInbox, setTerritoryInbox] = useState([])
  const [loadingInbox,   setLoadingInbox]   = useState(true)

  useEffect(() => {
    loadData()
    checkActiveSession()
  }, [])

  async function loadData() {
    // Pull up to 500 submitted sessions — enough for multi-month lifetime totals.
    const [sessions, commission, org] = await Promise.all([
      getRepSessions(user.id, 500),
      getMyCommissionConfig(),
      getMyOrganization(),
    ])
    setAllSessions(sessions)
    setCommissionCfg(commission)
    if (org) {
      setGoalCfg({
        daily_goal_type:  org.daily_goal_type  || DEFAULT_GOAL.daily_goal_type,
        daily_goal_value: Number(org.daily_goal_value ?? DEFAULT_GOAL.daily_goal_value),
        count_goal_label: org.count_goal_label || DEFAULT_GOAL.count_goal_label,
      })
    }
    setLoadingData(false)

    // Compute the best-hour nudge off the main loading path — the card
    // is a nice-to-have, not gating the start button. If the rep has no
    // interactions or too few bookings, computeBestHour returns null
    // and the card stays hidden.
    getRepOutcomesForHour(user.id, 60)
      .then((rows) => setBestHour(computeBestHour(rows)))
      .catch(() => setBestHour(null))

    // Load the three leaderboard slices that power the rank-movement and
    // team-pulse callouts. Last-week range runs from -14d to -7d so we can
    // compare an apples-to-apples window against the trailing-7d "this week"
    // board. Failures silently leave the arrays empty → callouts stay hidden.
    const priorWeekEnd   = new Date(Date.now() -  7 * 86_400_000).toISOString()
    const priorWeekStart = new Date(Date.now() - 14 * 86_400_000).toISOString()
    Promise.all([
      getLeaderboardData('today').catch(() => []),
      getLeaderboardData('week').catch(() => []),
      getLeaderboardRange(priorWeekStart, priorWeekEnd).catch(() => []),
    ]).then(([today, week, last]) => {
      setBoardToday(today || [])
      setBoardThisWeek(week || [])
      setBoardLastWeek(last || [])
    })

    // Territory inbox — loaded in parallel with the other dashboard data
    // so the Next Stops card fills in as soon as it's ready. Failures
    // silently leave the list empty rather than blocking the rest of the
    // dashboard (the card then renders the "no zones yet" empty state).
    getOrgTerritoriesForRep(user.id)
      .then((rows) => setTerritoryInbox(rows || []))
      .catch(() => setTerritoryInbox([]))
      .finally(() => setLoadingInbox(false))
  }

  // If an active session already exists in Supabase (e.g. rep closed the
  // tab mid-shift, phone died, browser crashed), re-enter it with all
  // previously-logged interactions so stats and pins aren't lost. The
  // SessionContext has likely already primed from localStorage by this
  // point; we overwrite it with the authoritative DB state.
  async function checkActiveSession() {
    const existing = await getActiveSession(user.id)
    if (!existing) return
    try {
      const interactions = await getSessionInteractions(existing.id)
      dispatch({
        type:         'HYDRATE_SESSION',
        session:      existing,
        interactions: interactions || [],
      })
    } catch (err) {
      // DB fetch failed — fall back to a bare re-start so the rep can at
      // least keep going. Their pending-save interactions already live in
      // Supabase and will show up once connectivity returns.
      console.warn('[Session] Hydrate failed, using bare restart:', err?.message)
      dispatch({ type: 'START_SESSION', session: existing })
    }
    startGPS(existing)
    navigate('/canvassing')
  }

  async function handleLogout() {
    // Guard against accidental taps on a small target. If a session is
    // actively hydrated in state we warn loudly; otherwise a light confirm
    // is enough.
    const hasActive = !!state.session
    const msg = hasActive
      ? 'You have an active canvassing session. Logging out will stop tracking. Continue?'
      : 'Log out of KnockIQ?'
    if (!window.confirm(msg)) return
    try {
      // Stop GPS + detector so the browser doesn't keep a watchPosition
      // handle alive across the sign-in boundary.
      try { gpsTracker.stop?.() } catch { /* ignore */ }
      try { motionClassifier.stop?.() } catch { /* ignore */ }
      await signOut()
    } catch (err) {
      console.warn('[Logout] signOut failed', err)
    }
    navigate('/login', { replace: true })
  }

  const handleStartCanvassing = async () => {
    setGpsError('')
    setLoadingStart(true)
    try {
      await requestGPSPermission()
    } catch (err) {
      setGpsError('GPS access is required to canvass. Please enable location permissions and try again.')
      setLoadingStart(false)
      return
    }

    // iOS 13+ requires DeviceMotionEvent.requestPermission() from a user
    // gesture — this handler IS that gesture. We fire-and-forget; the
    // detector falls back to GPS-only logic if motion is denied or
    // unsupported, so we never block canvassing on the result.
    motionClassifier.start().catch(() => {})

    // Kick off DNK polygon load in the background. Non-blocking because
    // the detector treats an empty zone list as "nothing to suppress".
    loadDnkZones().catch(() => {})

    const { data: session, error } = await startSession(user.id)
    if (error) { setGpsError(error.message); setLoadingStart(false); return }

    dispatch({ type: 'START_SESSION', session })
    startGPS(session)
    setLoadingStart(false)
    navigate('/canvassing')
  }

  function startGPS(session) {
    const detector = new DoorKnockDetector({
      repId: user.id,
      onKnock: (knock) => dispatch({ type: 'REGISTER_KNOCK', knock }),
      motionClassifier,
      // Resolved each call against the latest dnkZones array — safe even
      // if zones load after the detector is wired up.
      isInDoNotKnockZone: (lat, lng) => !!pointInAnyZone(lat, lng, dnkZones),
      // Adaptive polling: detector tells us when the rep is moving vs
      // stopped and we dial GPS accuracy to match.
      onModeChange: (mode) => gpsTracker.setMode(mode === 'stopped' ? 'stopped' : 'moving'),
    })
    doorKnockRef.current = detector

    gpsTracker.start({
      sessionId: session.id,
      repId:     user.id,
      onPosition: async (point) => {
        dispatch({ type: 'ADD_GPS_POINT', point })
        await detector.feed(point)
        await updateSessionStats(session.id, {
          doors_knocked:  state.stats.doors,
          conversations:  state.stats.conversations,
          estimates:      state.stats.estimates,
          bookings:       state.stats.bookings,
          revenue_booked: state.stats.revenue,
        })
      },
      onError: (err) => console.warn('[GPS]', err),
    })
  }

  // Time-of-day greeting replaces the static "Welcome back".
  const greeting = getGreeting()

  // ── Derived numbers ─────────────────────────────────────────────────────────
  const periods = computePeriodStats(allSessions)
  const stats   = periods[period] || periods.week

  // ── Daily series powering the sparkline + trend chip on each stat card ──
  // Uses the same groupSessionsByDay helper the manager overview uses so the
  // visual treatment stays consistent across the two screens. The window
  // length mirrors the selected period:
  //   week     → Mon-to-today (1–7 days)
  //   month    → 1st-to-today (1–31 days)
  //   lifetime → most recent 30 days of session history
  const repDays  = daysForRepPeriod(period, allSessions)
  const repDaily = groupSessionsByDay(allSessions, repDays)
  const doorsTrend    = computeTrend(repDaily, 'doors')
  const bookingsTrend = computeTrend(repDaily, 'bookings')
  const revenueTrend  = computeTrend(repDaily, 'revenue')

  const todayKey   = format(new Date(), 'yyyy-MM-dd')
  const todayStats = allSessions
    .filter(s => s.started_at.startsWith(todayKey))
    .reduce((acc, s) => ({
      doors:     acc.doors     + (s.doors_knocked  || 0),
      revenue:   acc.revenue   + (Number(s.revenue_booked) || 0),
      bookings:  acc.bookings  + (s.bookings  || 0),
      estimates: acc.estimates + (s.estimates || 0),
    }), { doors: 0, revenue: 0, bookings: 0, estimates: 0 })

  // Pick the right metric for the manager-configured goal. "count" goals
  // measure estimates *or* appointments depending on terminology — the
  // underlying field is the same either way (sessions.estimates).
  const countNoun = goalCfg.count_goal_label === 'appointments' ? 'appointments' : 'estimates'
  const isRevenueGoal = goalCfg.daily_goal_type === 'revenue'
  const goalTarget  = Number(goalCfg.daily_goal_value) || 0
  const goalCurrent = isRevenueGoal ? todayStats.revenue : todayStats.estimates
  const goalPct = goalTarget > 0
    ? Math.min((goalCurrent / goalTarget) * 100, 100)
    : 0
  const goalCurrentLabel = isRevenueGoal
    ? `$${goalCurrent.toFixed(0)}`
    : `${goalCurrent}`
  const goalTargetLabel = isRevenueGoal
    ? `$${goalTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${goalTarget} ${countNoun}`
  const lifetimeXP  = computeXP(periods.lifetime)
  const levelInfo   = computeLevel(lifetimeXP)
  const commission  = calcCommission(stats, commissionCfg)
  const conversion  = computeConversion(stats)

  // Callout payloads — each helper returns null when the underlying data
  // can't credibly fill the card, and <RepCallouts> then omits it entirely.
  // Cheap to compute every render (all pure array passes over data we
  // already have in state), so no useMemo ceremony needed.
  // Count of zones the manager has flagged for this rep. Feeds the pip
  // on the header Inbox button — kept here as a derived number so a late
  // territoryInbox load simply re-renders the header without touching
  // any other state.
  const assignedInboxCount = (territoryInbox || []).filter((t) => t.assigned_to_me).length

  const rankMovement   = computeRankMovement(boardThisWeek, boardLastWeek, user.id)
  const drySpell       = computeDrySpell(allSessions)
  const personalBest   = computePersonalBestCloseRate(allSessions)
  const closeDiag      = computeCloseRateDiagnostic(periods)
  const levelProximity = computeLevelUpProximity(levelInfo)
  const teamPulse      = computeTeamPulse(boardToday, user.id)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-10">

      {/* ── Slim Header (no stats, just identity) ──────────────────────────── */}
      <div
        className="px-5 pt-12 pb-5"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/profile')}
            className="w-11 h-11 rounded-full overflow-hidden bg-white shrink-0 flex items-center justify-center"
            aria-label="Open profile"
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold" style={{ color: BRAND_BLUE }}>
                {(user?.full_name || 'R')[0].toUpperCase()}
              </span>
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">{greeting}</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">{user?.full_name || 'Rep'}</h1>
          </div>
          {/* Next Stops — territories inbox. Moved here from the body
              card so the entry point lives with the other header actions
              (profile, logout) and is reachable from every scroll
              position. The assigned-count pip acts as an unread-style
              indicator — if a manager has flagged a zone for this rep,
              the dot shows how many are waiting. */}
          <button
            onClick={() => navigate('/territories')}
            className="relative p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Next Stops"
          >
            <Inbox className="w-5 h-5 text-white" />
            {assignedInboxCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{ backgroundColor: BRAND_LIME, color: '#1E3A10' }}
              >
                {assignedInboxCount > 9 ? '9+' : assignedInboxCount}
              </span>
            )}
          </button>
          <button
            onClick={() => navigate('/profile')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Settings"
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
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 w-full max-w-xl mx-auto px-4 pt-5 space-y-3">

        {/* Start Canvassing — hero CTA (blue, breathing room above) */}
        <button
          onClick={handleStartCanvassing}
          disabled={loadingStart}
          className="btn-brand w-full rounded-2xl text-xl font-bold active:scale-[0.99] transition-transform flex items-center justify-start gap-3 py-5 px-5"
        >
          {loadingStart ? (
            <>
              <span className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </span>
              Getting GPS…
            </>
          ) : (
            <>
              <span className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <Play className="w-5 h-5 text-white" fill="currentColor" />
              </span>
              Start Canvassing
            </>
          )}
        </button>

        {gpsError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
            {gpsError}
          </div>
        )}

        {/* Personalized nudge stack — hot-hour, rank movement, dry spell,
            personal-best close rate, level-up proximity, team pulse, and a
            close-rate diagnostic. Each card hides itself when its payload
            is null OR the rep has toggled it off in Profile → Home Callouts,
            so the stack stays relevant without ever showing empty stubs. */}
        <RepCallouts
          bestHour={bestHour}
          rankMovement={rankMovement}
          drySpell={drySpell}
          personalBest={personalBest}
          closeDiag={closeDiag}
          levelProximity={levelProximity}
          teamPulse={teamPulse}
        />

        {/* Next Stops moved to its own page (/territories) — entry point
            is the Inbox icon in the header with a pip showing assigned
            count. The home view now leads with the rep's numbers instead
            of a static inbox card. */}

        {/* Scoreboard row: Today's Goal + Level (2 cards, same styling) */}
        <div className="grid grid-cols-2 gap-2.5">
          <GoalCard
            current={goalCurrent}
            target={goalTarget}
            pct={goalPct}
            currentLabel={goalCurrentLabel}
            targetLabel={goalTargetLabel}
          />
          <LevelCard level={levelInfo} />
        </div>

        {/* Stats Section with period tabs */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-gray-800 font-bold text-base flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              My Numbers
            </h2>
            <PeriodTabs period={period} onChange={setPeriod} />
          </div>

          {loadingData ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 flex items-center justify-center">
              <div className="animate-spin w-6 h-6 rounded-full border-4 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* Headline numbers — gradient cards + micro-charts. Same
                  visual language the manager view uses, so a rep sees the
                  same dashboards when they get promoted. Commission keeps
                  its own hero-gradient card since it reads as a reward,
                  not a trendable metric. */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <RichStatCard
                  label="Doors"
                  value={stats.doors.toLocaleString()}
                  trend={doorsTrend}
                  icon={<MapPin className="w-4 h-4" />}
                  gradient="from-blue-100 via-blue-50 to-white"
                  border="border-blue-200/60"
                  iconColor="text-blue-700"
                >
                  <MiniSparkBars values={repDaily.map((d) => d.doors)} color="#2757d7" highlight="#1e44b0" />
                </RichStatCard>

                <RichStatCard
                  label="Bookings"
                  value={stats.bookings.toLocaleString()}
                  trend={bookingsTrend}
                  icon={<Trophy className="w-4 h-4" />}
                  gradient="from-teal-100 via-teal-50 to-white"
                  border="border-teal-200/60"
                  iconColor="text-teal-700"
                >
                  <MiniSparkArea values={repDaily.map((d) => d.bookings)} color="#0d9488" fill="#14b8a673" />
                </RichStatCard>

                <RichStatCard
                  label="Revenue"
                  value={`$${formatCompact(stats.revenue)}`}
                  trend={revenueTrend}
                  icon={<DollarSign className="w-4 h-4" />}
                  gradient="from-lime-100 via-lime-50 to-white"
                  border="border-lime-200/60"
                  iconColor="text-lime-700"
                >
                  <MiniSparkArea values={repDaily.map((d) => d.revenue)} color="#5ea636" fill="#7ac94373" />
                </RichStatCard>

                <CommissionCard
                  amount={commission}
                  config={commissionCfg}
                />
              </div>

              {/* Funnel / Conversion */}
              <ConversionFunnel
                stats={stats}
                conv={conversion}
                estimateLabel={countNoun === 'appointments' ? 'Appointments' : 'Estimates'}
              />
            </>
          )}
        </section>

        {/* Recent Sessions (compact) */}
        {allSessions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-gray-700 font-semibold text-sm">Recent Sessions</h2>
              <span className="text-gray-400 text-xs">{allSessions.length} total</span>
            </div>
            <div className="space-y-2">
              {allSessions.slice(0, 4).map(s => (
                <SessionRow key={s.id} session={s} onClick={() => navigate('/session/' + s.id)} />
              ))}
            </div>
          </section>
        )}

        {allSessions.length === 0 && !loadingData && (
          <div className="text-center py-8 text-gray-400">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Your journey starts here</p>
            <p className="text-sm mt-1">Hit Start Canvassing to earn your first XP.</p>
          </div>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="mt-6 pt-6 pb-8 flex flex-col items-center gap-1.5 border-t border-gray-100">
        <img
          src="/logo.png"
          alt="KnockIQ"
          className="h-10 w-auto object-contain opacity-80"
        />
        <p className="text-[11px] text-gray-400">© {new Date().getFullYear()} KnockIQ</p>
      </footer>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

export function PeriodTabs({ period, onChange }) {
  const tabs = [
    { id: 'week',     label: 'Week'     },
    { id: 'month',    label: 'Month'    },
    { id: 'lifetime', label: 'Lifetime' },
  ]
  return (
    <div className="bg-gray-100 rounded-full p-1 flex text-xs">
      {tabs.map(t => {
        const active = t.id === period
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`px-3 py-1.5 rounded-full font-semibold transition-colors ${active ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Today's goal card — conic-gradient ring + target text. Matches LevelCard
 * sizing so the two sit side-by-side as a scoreboard row.
 */
export function GoalCard({ pct, currentLabel, targetLabel }) {
  const capped   = Math.max(0, Math.min(100, pct))
  const ringDeg  = (capped / 100) * 360
  const ringColor = capped >= 100 ? '#F59E0B' : '#7DC31E'
  return (
    <div className="bg-white rounded-2xl p-3.5 border border-gray-100 shadow-sm min-h-[110px] flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1">
        <Target className="w-3 h-3" /> Today's Goal
      </p>
      <div className="flex items-center gap-2.5">
        <div
          className="w-[52px] h-[52px] rounded-full grid place-items-center shrink-0 relative"
          style={{
            background: `conic-gradient(${ringColor} ${ringDeg}deg, #f3f4f6 0)`,
          }}
        >
          <div className="w-10 h-10 rounded-full bg-white grid place-items-center">
            <span className="text-[10px] font-bold text-green-700">
              {Math.round(capped)}%
            </span>
          </div>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[22px] font-bold text-gray-900 leading-none tabular-nums truncate">
            {currentLabel}
          </span>
          <span className="text-[11px] text-gray-500 font-medium mt-0.5 truncate">
            of {targetLabel}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Level card — matches Goal card styling (white) with a yellow XP bar
 * and a unique tier-themed badge in the top-right. Each level gets a
 * different emoji + gradient; higher levels look more epic (gold, phoenix,
 * cosmic, holographic). Reps don't see a list of future levels — each
 * one is revealed on level-up as a surprise.
 */
export function LevelCard({ level }) {
  const pct = Math.round(level.progress * 100)
  return (
    <div className="bg-white rounded-2xl p-3.5 border border-gray-100 shadow-sm min-h-[110px] flex flex-col gap-2 relative overflow-hidden">
      <LevelBadge tier={level.tier} icon={level.icon} />
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Level {level.level} · {level.title}
      </p>
      <div className="text-[22px] font-bold text-gray-900 leading-none tabular-nums">
        {level.xpIntoLevel.toLocaleString()}
        <span className="text-[11px] font-semibold text-gray-500 ml-0.5">
          {' '}/ {level.xpForNext.toLocaleString()} XP
        </span>
      </div>
      <div className="h-[5px] bg-gray-100 rounded-full overflow-hidden mt-0.5">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #FACC15 0%, #F59E0B 100%)',
          }}
        />
      </div>
      <p className="text-[11px] text-gray-500 font-medium mt-auto">
        {(level.xpForNext - level.xpIntoLevel).toLocaleString()} XP to level {level.level + 1}
      </p>
    </div>
  )
}

/**
 * Tiered level badge — a small circular emoji badge in the top-right
 * corner of the Level card. Gradient + glow escalate as tiers progress
 * from Rookie → Knock God.
 */
export function LevelBadge({ tier, icon }) {
  const style = TIER_STYLES[tier] || TIER_STYLES.rookie
  return (
    <span
      className="absolute top-2 right-2 w-8 h-8 rounded-full grid place-items-center text-[16px] leading-none"
      style={style}
      aria-hidden="true"
    >
      {icon}
    </span>
  )
}

// Keep all gradient/shadow bundles in one object so a new tier is just a
// one-line addition. Glow intensity rises with rarity.
const TIER_STYLES = {
  rookie:    { background: 'linear-gradient(135deg, #d1fae5, #86efac)',                                               boxShadow: '0 2px 6px rgba(16,185,129,0.25)' },
  bronze:    { background: 'linear-gradient(135deg, #fcd9b3, #c77a3a)',                                               boxShadow: '0 2px 8px rgba(199,122,58,0.35)' },
  silver:    { background: 'linear-gradient(135deg, #f1f5f9, #94a3b8)',                                               boxShadow: '0 2px 8px rgba(100,116,139,0.35)' },
  ninja:     { background: 'linear-gradient(135deg, #a78bfa, #6d28d9)',   color: '#fff',                              boxShadow: '0 2px 10px rgba(109,40,217,0.45)' },
  gold:      { background: 'linear-gradient(135deg, #fde68a, #f59e0b)',                                               boxShadow: '0 2px 10px rgba(245,158,11,0.45)' },
  legend:    { background: 'linear-gradient(135deg, #fb923c, #ef4444)',                                               boxShadow: '0 2px 12px rgba(239,68,68,0.5)' },
  titan:     { background: 'linear-gradient(135deg, #22d3ee, #2563eb)',   color: '#fff',                              boxShadow: '0 2px 12px rgba(37,99,235,0.5)' },
  mythic:    { background: 'linear-gradient(135deg, #f0abfc 0%, #7dd3fc 35%, #fde047 70%, #fb7185 100%)',             boxShadow: '0 2px 14px rgba(236,72,153,0.55)' },
  diamond:   { background: 'linear-gradient(135deg, #bae6fd, #0ea5e9)',   color: '#fff',                              boxShadow: '0 2px 12px rgba(14,165,233,0.5)' },
  platinum:  { background: 'linear-gradient(135deg, #e2e8f0, #475569)',   color: '#fff',                              boxShadow: '0 2px 12px rgba(71,85,105,0.55)' },
  royal:     { background: 'linear-gradient(135deg, #fde68a, #dc2626)',   color: '#fff',                              boxShadow: '0 2px 14px rgba(220,38,38,0.55)' },
  phoenix:   { background: 'linear-gradient(135deg, #fde047 0%, #fb923c 40%, #dc2626 100%)',                          boxShadow: '0 2px 14px rgba(251,146,60,0.6)' },
  celestial: { background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #7c3aed 100%)', color: '#fff',           boxShadow: '0 2px 16px rgba(124,58,237,0.55)' },
  cosmic:    { background: 'linear-gradient(135deg, #312e81 0%, #6d28d9 40%, #db2777 100%)', color: '#fff',           boxShadow: '0 2px 18px rgba(219,39,119,0.55)' },
  galaxy:    { background: 'linear-gradient(135deg, #0b1020 0%, #4c1d95 50%, #db2777 100%)', color: '#fff',           boxShadow: '0 2px 20px rgba(76,29,149,0.65)' },
  god:       { background: 'conic-gradient(from 0deg, #fde047, #fb7185, #a78bfa, #60a5fa, #4ade80, #fde047)', color: '#1a1203', boxShadow: '0 0 18px rgba(253,224,71,0.85), 0 0 30px rgba(236,72,153,0.5)' },
}

// Greeting is purely cosmetic — pick based on the rep's local clock.
function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return "Let's go, one more push"
}

export function BigStatCard({ icon, label, value, accent = 'blue' }) {
  const palettes = {
    blue:  { bg: 'bg-blue-50',  text: 'text-blue-600',  label: 'text-blue-700' },
    green: { bg: 'bg-green-50', text: 'text-green-600', label: 'text-green-700' },
    lime:  { bg: 'bg-lime-50',  text: 'text-lime-600',  label: 'text-lime-700' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'text-amber-700' },
  }
  const p = palettes[accent] || palettes.blue
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`${p.bg} ${p.text} w-7 h-7 rounded-lg flex items-center justify-center`}>
          {icon}
        </div>
        <p className={`text-[11px] uppercase tracking-wide font-semibold ${p.label}`}>{label}</p>
      </div>
      <p className="text-2xl font-extrabold text-gray-900 leading-tight">{value}</p>
    </div>
  )
}

export function CommissionCard({ amount, config }) {
  const hasConfig = !!config && (config.type !== 'flat_pct' || Number(config.value) > 0)
  return (
    <div
      className="rounded-2xl p-4 shadow-sm text-white relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #059669 0%, #7DC31E 100%)' }}
    >
      <div className="flex items-center gap-2 mb-1.5 relative z-10">
        <div className="bg-white/25 w-7 h-7 rounded-lg flex items-center justify-center">
          <DollarSign className="w-4 h-4" />
        </div>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-green-50">My Commission</p>
      </div>
      <p className="text-2xl font-extrabold leading-tight relative z-10">
        ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </p>
      <p className="text-[10px] text-green-50 mt-0.5 relative z-10 truncate">
        {hasConfig ? describeCommission(config) : 'Manager has not set a rate yet'}
      </p>
      <Trophy className="absolute -bottom-3 -right-2 w-16 h-16 text-white/10" />
    </div>
  )
}

export function ConversionFunnel({ stats, conv, estimateLabel = 'Estimates' }) {
  // Each bar: width proportional to its count vs. doors (the top of the funnel).
  const top = Math.max(stats.doors, 1)
  const lowerNoun = estimateLabel.toLowerCase()
  const rows = [
    { label: 'Doors Knocked',     count: stats.doors,         pctOfTop: 100,                               color: '#1B4FCC', pctLabel: null },
    { label: 'Conversations',     count: stats.conversations, pctOfTop: (stats.conversations / top) * 100, color: '#6366F1', pctLabel: `${conv.contactRate.toFixed(0)}% of doors` },
    { label: estimateLabel,       count: stats.estimates,     pctOfTop: (stats.estimates     / top) * 100, color: '#7DC31E', pctLabel: `${conv.estimateRate.toFixed(0)}% of convos` },
    { label: 'Bookings',          count: stats.bookings,      pctOfTop: (stats.bookings      / top) * 100, color: '#059669', pctLabel: `${conv.closeRate.toFixed(0)}% of ${lowerNoun}` },
  ]

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-gray-700 font-semibold text-sm flex items-center gap-1.5">
          <Users className="w-4 h-4 text-gray-400" /> Conversion Funnel
        </p>
        <p className="text-[11px] font-semibold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full">
          {conv.overallClose.toFixed(1)}% close rate
        </p>
      </div>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.label}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="font-semibold text-gray-700">{r.label}</span>
              <span className="text-gray-500">
                {r.count.toLocaleString()}
                {r.pctLabel && <span className="ml-2 text-gray-400">· {r.pctLabel}</span>}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(r.pctOfTop, 2)}%`, backgroundColor: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * NextStopsCard — the rep's territory inbox.
 *
 * Shows every zone in the org. Zones the manager has flagged for this rep
 * ("priority") float to the top and get a lime "Assigned" chip; the rest
 * are suggestions, sorted by staleness (least-recently-canvassed first).
 *
 * The card intentionally does NOT show dates or deadlines — territories
 * are durable regions the rep can revisit whenever, not one-off tasks.
 * Category tag and last-knock recency are the two coordinates the rep
 * actually needs to decide where to go next.
 */
function NextStopsCard({ territories, loading }) {
  if (loading) {
    return (
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <p className="text-gray-700 font-semibold text-sm flex items-center gap-1.5 mb-2">
          <Inbox className="w-4 h-4 text-gray-400" /> Next Stops
        </p>
        <div className="h-16 bg-gray-50 rounded-lg animate-pulse" />
      </section>
    )
  }

  if (!territories || territories.length === 0) {
    return (
      <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
        <p className="text-gray-700 font-semibold text-sm flex items-center gap-1.5 mb-2">
          <Inbox className="w-4 h-4 text-gray-400" /> Next Stops
        </p>
        <div className="flex items-start gap-2.5 text-gray-500 text-xs">
          <Map className="w-4 h-4 text-gray-300 mt-0.5 shrink-0" />
          <p>
            No territories yet. Once your manager draws a zone in the
            Territories tab, it'll show up here.
          </p>
        </div>
      </section>
    )
  }

  // Sort: assigned first, then by last-knocked asc (stale zones float up,
  // with "never" treated as the stalest). This matches the product intent
  // that a rep should always see *somewhere* to go next.
  const sorted = [...territories].sort((a, b) => {
    if (a.assigned_to_me !== b.assigned_to_me) return a.assigned_to_me ? -1 : 1
    const aT = a.last_knock_at ? new Date(a.last_knock_at).getTime() : 0
    const bT = b.last_knock_at ? new Date(b.last_knock_at).getTime() : 0
    return aT - bT
  })

  const assignedCount = sorted.filter((t) => t.assigned_to_me).length

  return (
    <section className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <p className="text-gray-700 font-semibold text-sm flex items-center gap-1.5">
          <Inbox className="w-4 h-4 text-gray-400" />
          Next Stops
        </p>
        {assignedCount > 0 && (
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ background: '#F1F8E1', color: '#4A7A17' }}
          >
            {assignedCount} assigned to you
          </span>
        )}
      </div>
      <div className="space-y-2">
        {sorted.map((t) => (
          <TerritoryRow key={t.id} territory={t} />
        ))}
      </div>
    </section>
  )
}

function TerritoryRow({ territory }) {
  const color = territory.color || '#3B82F6'
  const recency = describeRecency(territory.last_knock_at)
  const assigned = territory.assigned_to_me
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${assigned ? 'bg-lime-50/60 border-lime-200' : 'bg-white border-gray-100'}`}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}1F`, color }}
      >
        {assigned ? <Flag className="w-4 h-4" fill="currentColor" /> : <MapPin className="w-4 h-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-gray-900 truncate">{territory.name}</p>
          {territory.category && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0"
              style={{ backgroundColor: `${color}18`, color }}
            >
              {territory.category}
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500 mt-0.5 truncate">
          {assigned ? 'Assigned to you · ' : ''}
          {recency}
          {territory.interaction_count > 0 && ` · ${territory.interaction_count} knock${territory.interaction_count === 1 ? '' : 's'} logged`}
        </p>
      </div>
    </div>
  )
}

function describeRecency(iso) {
  if (!iso) return 'Never canvassed'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0)    return 'Canvassed today'
  if (days === 1)    return 'Canvassed yesterday'
  if (days < 7)      return `Canvassed ${days} days ago`
  if (days < 30)     return `Canvassed ${Math.floor(days / 7)} wk ago`
  if (days < 365)    return `Canvassed ${Math.floor(days / 30)} mo ago`
  return `Canvassed ${Math.floor(days / 365)} yr ago`
}

export function SessionRow({ session, onClick }) {
  const elapsed = session.ended_at
    ? ((new Date(session.ended_at) - new Date(session.started_at)) / 60000).toFixed(0)
    : null

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl px-4 py-3 flex items-center justify-between shadow-sm active:bg-gray-50 text-left border border-gray-100">
      <div>
        <p className="font-medium text-gray-900 text-sm">
          {format(new Date(session.started_at), 'EEE, MMM d')}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {session.doors_knocked} doors · {elapsed ? `${elapsed} min` : '—'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="font-bold text-gray-900">${(session.revenue_booked || 0).toFixed(0)}</p>
          <p className="text-xs text-green-600">{session.bookings || 0} booked</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
      </div>
    </button>
  )
}
