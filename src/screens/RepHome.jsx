import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  MapPin, DollarSign, Settings, Trophy, Play,
  TrendingUp, Users, Target, ChevronRight, Sparkles, LogOut,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import {
  startSession, getRepSessions, getActiveSession,
  updateSessionStats, getMyCommissionConfig, getSessionInteractions,
  getMyOrganization, getRepOutcomesForHour, signOut,
  getLeaderboardData, getLeaderboardRange,
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
        style={{ background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #2E6BFF 100%)` }}
      >
        <div className="flex items-center gap-3">
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
      <div className="flex-1 px-4 pt-5 space-y-3">

        {/* Start Canvassing — hero CTA (blue, breathing room above) */}
        <button
          onClick={handleStartCanvassing}
          disabled={loadingStart}
          className="w-full rounded-2xl text-white text-xl font-bold active:scale-[0.99] transition-transform disabled:opacity-70 flex items-center justify-start gap-3 py-5 px-5"
          style={{
            background: BRAND_BLUE,
            boxShadow: '0 10px 24px rgba(27, 79, 204, 0.35)',
          }}
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
              {/* Headline numbers */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <BigStatCard
                  icon={<MapPin className="w-4 h-4" />}
                  label="Doors"
                  value={stats.doors.toLocaleString()}
                  accent="blue"
                />
                <BigStatCard
                  icon={<Trophy className="w-4 h-4" />}
                  label="Bookings"
                  value={stats.bookings.toLocaleString()}
                  accent="lime"
                />
                <BigStatCard
                  icon={<DollarSign className="w-4 h-4" />}
                  label="Revenue"
                  value={`$${stats.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  accent="green"
                />
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
