import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  MapPin, DollarSign, LogOut, Settings, Trophy,
  TrendingUp, Users, Target, ChevronRight, Sparkles, Zap,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import {
  startSession, getRepSessions, getActiveSession, signOut,
  updateSessionStats, getMyCommissionConfig, getSessionInteractions,
  getMyOrganization,
} from '../lib/supabase.js'
import { requestGPSPermission } from '../lib/gps.js'
import { gpsTracker } from '../lib/gps.js'
import { DoorKnockDetector } from '../lib/doorKnock.js'
import {
  computePeriodStats, computeConversion,
  computeXP, computeLevel, calcCommission, describeCommission,
} from '../lib/repStats.js'

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

  const handleSignOut = async () => { await signOut() }

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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-10">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="px-5 pt-12 pb-6 rounded-b-3xl"
        style={{ background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #2E6BFF 100%)` }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/profile')}
              className="w-10 h-10 rounded-full overflow-hidden bg-white/20 shrink-0 flex items-center justify-center"
              aria-label="Open profile"
            >
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-sm font-bold">
                  {(user?.full_name || 'R')[0].toUpperCase()}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <p className="text-blue-200 text-sm">Welcome back</p>
              <h1 className="text-white text-xl font-bold truncate">{user?.full_name || 'Rep'}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => navigate('/profile')} className="p-2 rounded-full bg-white/20 active:bg-white/30">
              <Settings className="w-5 h-5 text-white" />
            </button>
            <button onClick={handleSignOut} className="p-2 rounded-full bg-white/20 active:bg-white/30">
              <LogOut className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Today's Goal Progress */}
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

        {/* Start Button (unchanged position) */}
        <button
          onClick={handleStartCanvassing}
          disabled={loadingStart}
          className="w-full py-5 rounded-2xl text-white text-xl font-bold shadow-lg active:scale-95 transition-transform disabled:opacity-70 flex items-center justify-center gap-2"
          style={{ background: `linear-gradient(135deg, ${BRAND_BLUE} 0%, #2E6BFF 100%)` }}
        >
          {loadingStart ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Getting GPS…
            </>
          ) : <>▶  Start Canvassing</>}
        </button>

        {gpsError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
            {gpsError}
          </div>
        )}

        {/* Level (Gamification) */}
        <LevelCard level={levelInfo} />

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

export function LevelCard({ level, className = '' }) {
  const pct = Math.round(level.progress * 100)
  return (
    <div
      className={`${className} rounded-2xl p-4 shadow-sm text-white overflow-hidden relative`}
      style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #6B42FF 100%)' }}
    >
      <div className="flex items-center justify-between mb-2 relative z-10">
        <div>
          <p className="text-blue-100 text-xs font-medium uppercase tracking-wide">Level {level.level}</p>
          <p className="text-white font-bold text-lg leading-tight">{level.title}</p>
        </div>
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
          <Zap className="w-5 h-5 text-yellow-300" fill="currentColor" />
        </div>
      </div>

      <div className="h-2 bg-white/25 rounded-full overflow-hidden relative z-10">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: '#FFD93D' }}
        />
      </div>
      <p className="text-blue-100 text-[11px] mt-1.5 relative z-10">
        {level.xpIntoLevel.toLocaleString()} / {level.xpForNext.toLocaleString()} XP to level {level.level + 1}
      </p>

      {/* Decorative sparkle */}
      <Sparkles className="absolute -bottom-2 -right-2 w-16 h-16 text-white/10" />
    </div>
  )
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
