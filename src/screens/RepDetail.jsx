/**
 * RepDetail — manager-only drill-down into a single rep's home-page stats.
 *
 * Reached from ManagerDashboard → Reps tab by tapping any rep card. Shows
 * the same period-aware numbers the rep sees on their own RepHome: today's
 * goal progress, gamification level, doors / bookings / revenue / commission
 * cards, conversion funnel, and recent sessions.
 *
 * Data flow:
 *   - getRepById(repId) for name, avatar, commission_config
 *   - getRepSessions(repId, 500) for submitted sessions (RLS lets managers
 *     read sessions in their org)
 *   - getMyOrganization() for the configured daily goal + terminology
 *
 * This screen is READ-ONLY — no "Start Canvassing" button, no sign-out —
 * and is protected by the manager-only route gate in App.jsx.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ChevronLeft, MapPin, DollarSign, Trophy, TrendingUp, Target, Sparkles,
} from 'lucide-react'
import {
  getRepById, getRepSessions, getMyOrganization,
} from '../lib/supabase.js'
import {
  computePeriodStats, computeConversion,
  computeXP, computeLevel, calcCommission,
} from '../lib/repStats.js'
import {
  PeriodTabs, LevelCard, BigStatCard, CommissionCard, ConversionFunnel, SessionRow,
} from './RepHome.jsx'

const BRAND_BLUE = '#1B4FCC'
const DEFAULT_GOAL = {
  daily_goal_type:  'revenue',
  daily_goal_value: 1000,
  count_goal_label: 'estimates',
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
        className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
        style={{ backgroundColor: BRAND_BLUE }}
      >
        Back to Dashboard
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-10">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="px-5 pt-12 pb-6 rounded-b-3xl"
        style={{ background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #2E6BFF 100%)` }}
      >
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>

          <div className="w-10 h-10 rounded-full overflow-hidden bg-white/20 shrink-0 flex items-center justify-center">
            {rep?.avatar_url ? (
              <img src={rep.avatar_url} alt={rep.full_name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-sm font-bold">
                {(rep?.full_name || 'R')[0].toUpperCase()}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-blue-200 text-xs">Rep Detail</p>
            <h1 className="text-white text-xl font-bold truncate">
              {rep?.full_name || rep?.email || 'Rep'}
            </h1>
          </div>
        </div>

        {/* Today's Goal Progress — mirrors RepHome */}
        <div className="bg-white/15 backdrop-blur rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-white font-semibold text-sm flex items-center gap-1.5">
              <Target className="w-4 h-4" /> Today's Goal
            </span>
            <span className="text-white font-bold">
              {goalCurrentLabel}
              <span className="text-blue-200 font-normal"> / {goalTargetLabel}</span>
            </span>
          </div>
          <div className="h-2.5 bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${goalPct}%`, backgroundColor: goalPct >= 100 ? '#FFD700' : '#86EFAC' }}
            />
          </div>
          {todayStats.doors > 0 && (
            <p className="text-blue-200 text-xs mt-2">
              {todayStats.doors} door{todayStats.doors === 1 ? '' : 's'} knocked today
              {goalPct >= 100 && <span className="ml-2 font-semibold text-yellow-300">🔥 Goal crushed!</span>}
            </p>
          )}
        </div>
      </div>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pt-6 space-y-5">

        {/* Level (Gamification) */}
        <LevelCard level={levelInfo} />

        {/* Stats Section with period tabs */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-gray-800 font-bold text-base flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              Rep Numbers
            </h2>
            <PeriodTabs period={period} onChange={setPeriod} />
          </div>

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
