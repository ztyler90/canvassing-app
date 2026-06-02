/**
 * RepDetail — manager-only drill-down into a single rep's home-page stats.
 *
 * Reached from ManagerDashboard → Reps tab by tapping any rep card. Mirrors
 * the rep's own RepHome dashboard 1:1 so a manager sees exactly what the
 * rep sees, including the goal/level scoreboard, gradient stat cards with
 * sparklines + trend chips, conversion funnel, and recent sessions.
 *
 * Data flow:
 *   - getRepById(repId) for name, avatar, commission_config
 *   - getRepSessions(repId, 500) for submitted sessions (RLS lets managers
 *     read sessions in their org)
 *   - getMyOrganization() for the configured daily goal + terminology
 *
 * This screen is READ-ONLY — no "Start Canvassing" button, no sign-out, no
 * personalized callouts, no Next Stops inbox (those are rep-only) — and is
 * protected by the manager-only route gate in App.jsx.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format, differenceInCalendarDays, startOfWeek, startOfMonth } from 'date-fns'
import { StoragePhoto } from '../lib/photos.jsx'
import {
  ChevronLeft, MapPin, DollarSign, Trophy, TrendingUp, Sparkles,
} from 'lucide-react'
import {
  getRepById, getRepSessions, getMyOrganization,
} from '../lib/supabase.js'
import {
  computePeriodStats, computeConversion,
  computeXP, computeLevel, calcCommission,
} from '../lib/repStats.js'
import {
  PeriodTabs, GoalCard, LevelCard, CommissionCard, ConversionFunnel, SessionRow,
} from './RepHome.jsx'
import {
  RichStatCard, MiniSparkArea, MiniSparkBars,
  formatCompact, computeTrend, groupSessionsByDay,
} from '../components/StatSparkCards.jsx'

const BRAND_BLUE = '#1B4FCC'
const DEFAULT_GOAL = {
  daily_goal_type:  'revenue',
  daily_goal_value: 1000,
  count_goal_label: 'estimates',
}

// Mirrors daysForRepPeriod in RepHome — pick the window length for the
// sparkline based on the selected period tab. Kept local so RepDetail
// renders the same daily series the rep sees.
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

export default function RepDetail() {
  const { repId }  = useParams()
  const navigate   = useNavigate()

  const [rep,           setRep]           = useState(null)
  const [allSessions,   setAllSessions]   = useState([])
  const [goalCfg,       setGoalCfg]       = useState(DEFAULT_GOAL)
  const [period,        setPeriod]        = useState('week') // 'week' | 'month' | 'lifetime'
  const [loading,       setLoading]       = useState(true)
  const [notFound,      setNotFound]      = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setNotFound(false)
      const [profile, sessions, org] = await Promise.all([
        getRepById(repId),
        getRepSessions(repId, 500),
        getMyOrganization(),
      ])
      if (cancelled) return
      if (!profile) { setNotFound(true); setLoading(false); return }
      setRep(profile)
      setAllSessions(sessions)
      if (org) {
        setGoalCfg({
          daily_goal_type:  org.daily_goal_type  || DEFAULT_GOAL.daily_goal_type,
          daily_goal_value: Number(org.daily_goal_value ?? DEFAULT_GOAL.daily_goal_value),
          count_goal_label: org.count_goal_label || DEFAULT_GOAL.count_goal_label,
        })
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [repId])

  // ── Derived numbers ─────────────────────────────────────────────────────────
  const periods = computePeriodStats(allSessions)
  const stats   = periods[period] || periods.week

  // Daily series powering the sparkline + trend chip on each stat card.
  // Window length mirrors the selected period tab — same helper RepHome
  // uses, so the visual treatment stays consistent between the two screens.
  const repDays  = daysForRepPeriod(period, allSessions)
  const repDaily = groupSessionsByDay(allSessions, repDays)
  const doorsTrend    = computeTrend(repDaily, 'doors')
  const bookingsTrend = computeTrend(repDaily, 'bookings')
  const revenueTrend  = computeTrend(repDaily, 'revenue')

  const todayKey   = format(new Date(), 'yyyy-MM-dd')
  const todayStats = allSessions
    .filter((s) => s.started_at.startsWith(todayKey))
    .reduce((acc, s) => ({
      doors:     acc.doors     + (s.doors_knocked  || 0),
      revenue:   acc.revenue   + (Number(s.revenue_booked) || 0),
      estimates: acc.estimates + (s.estimates || 0),
    }), { doors: 0, revenue: 0, estimates: 0 })

  const countNoun     = goalCfg.count_goal_label === 'appointments' ? 'appointments' : 'estimates'
  const isRevenueGoal = goalCfg.daily_goal_type === 'revenue'
  const goalTarget    = Number(goalCfg.daily_goal_value) || 0
  const goalCurrent   = isRevenueGoal ? todayStats.revenue : todayStats.estimates
  const goalPct       = goalTarget > 0 ? Math.min((goalCurrent / goalTarget) * 100, 100) : 0
  const goalCurrentLabel = isRevenueGoal
    ? `$${goalCurrent.toFixed(0)}`
    : `${goalCurrent}`
  const goalTargetLabel = isRevenueGoal
    ? `$${goalTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${goalTarget} ${countNoun}`

  const lifetimeXP = computeXP(periods.lifetime)
  const levelInfo  = computeLevel(lifetimeXP)
  const commission = calcCommission(stats, rep?.commission_config)
  const conversion = computeConversion(stats)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <p className="text-gray-800 font-semibold">Rep not found</p>
      <p className="text-gray-500 text-sm mt-1">
        They may have been removed or belong to another organization.
      </p>
      <button
        onClick={() => navigate('/manager')}
        className="btn-brand mt-4 px-4 py-2 rounded-xl text-sm font-semibold"
      >
        Back to Dashboard
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-10">

      {/* ── Slim Header (identity + back button only) ──────────────────────── */}
      <div
        className="px-5 pt-12 pb-5"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>

          <div className="w-11 h-11 rounded-full overflow-hidden bg-white shrink-0 flex items-center justify-center">
            {rep?.avatar_url ? (
              <StoragePhoto pathOrUrl={rep.avatar_url} bucket="avatars" alt={rep.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-sm font-bold" style={{ color: BRAND_BLUE }}>
                {(rep?.full_name || 'R')[0].toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">Rep Detail</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              {rep?.full_name || rep?.email || 'Rep'}
            </h1>
          </div>
        </div>
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 w-full max-w-xl mx-auto px-4 pt-5 space-y-3">

        {/* Scoreboard row: Today's Goal + Level (mirrors RepHome) */}
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
              Rep Numbers
            </h2>
            <PeriodTabs period={period} onChange={setPeriod} />
          </div>

          {/* Headline numbers — gradient cards + micro-charts. Same visual
              language the rep sees on RepHome, so a manager drilling into
              a rep gets the same dashboards the rep is looking at. */}
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
              config={rep?.commission_config}
            />
          </div>

          {/* Funnel / Conversion */}
          <ConversionFunnel
            stats={stats}
            conv={conversion}
            estimateLabel={countNoun === 'appointments' ? 'Appointments' : 'Estimates'}
          />
        </section>

        {/* Recent Sessions */}
        {allSessions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-gray-700 font-semibold text-sm">Recent Sessions</h2>
              <span className="text-gray-400 text-xs">{allSessions.length} total</span>
            </div>
            <div className="space-y-2">
              {allSessions.slice(0, 8).map((s) => (
                <SessionRow key={s.id} session={s} onClick={() => navigate('/session/' + s.id)} />
              ))}
            </div>
          </section>
        )}

        {allSessions.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No sessions yet</p>
            <p className="text-sm mt-1">This rep hasn't submitted any canvassing sessions.</p>
          </div>
        )}
      </div>
    </div>
  )
}
