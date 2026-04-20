import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Home, Clock, DollarSign, Target, BarChart2 } from 'lucide-react'
import { useSession } from '../contexts/SessionContext.jsx'
import { getMyOrganization } from '../lib/supabase.js'
import { format } from 'date-fns'

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue
// Fallback used until the org row loads (and for pre-goal-config orgs).
const DEFAULT_GOAL = {
  daily_goal_type:  'revenue',
  daily_goal_value: 1000,
  count_goal_label: 'estimates',
}

export default function SessionSummary() {
  const { state, dispatch } = useSession()
  const navigate            = useNavigate()
  const { stats }           = state
  const [goalCfg, setGoalCfg] = useState(DEFAULT_GOAL)

  // If somehow landed here without data, go home
  useEffect(() => {
    if (state.isRunning) navigate('/canvassing', { replace: true })
  }, [state.isRunning])

  // Pull the manager-configured daily goal so this summary's progress bar
  // matches the home screen. Silent fallback to the default on failure —
  // the summary is non-blocking.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const org = await getMyOrganization()
        if (!org || cancelled) return
        setGoalCfg({
          daily_goal_type:  org.daily_goal_type  || DEFAULT_GOAL.daily_goal_type,
          daily_goal_value: Number(org.daily_goal_value ?? DEFAULT_GOAL.daily_goal_value),
          count_goal_label: org.count_goal_label || DEFAULT_GOAL.count_goal_label,
        })
      } catch { /* keep defaults */ }
    })()
    return () => { cancelled = true }
  }, [])

  const duration = stats.startedAt
    ? Math.floor((Date.now() - stats.startedAt) / 60000)
    : 0

  const doorsPerHour = duration > 0
    ? ((stats.doors / (duration / 60))).toFixed(1)
    : '—'

  const revenuePerHour = duration > 0 && stats.revenue > 0
    ? (stats.revenue / (duration / 60)).toFixed(0)
    : '0'

  const closeRate = stats.doors > 0
    ? ((stats.bookings / stats.doors) * 100).toFixed(1)
    : '0'

  const isRevenueGoal = goalCfg.daily_goal_type === 'revenue'
  const countNoun     = goalCfg.count_goal_label === 'appointments' ? 'appointments' : 'estimates'
  const goalTarget    = Number(goalCfg.daily_goal_value) || 0
  const goalCurrent   = isRevenueGoal ? stats.revenue : stats.estimates
  const goalPct       = goalTarget > 0 ? Math.min((goalCurrent / goalTarget) * 100, 100) : 0
  const goalReached   = goalTarget > 0 && goalCurrent >= goalTarget
  const goalProgressLabel = isRevenueGoal
    ? `$${stats.revenue.toFixed(0)} / $${goalTarget.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `${goalCurrent} / ${goalTarget} ${countNoun}`

  const handleDone = () => {
    dispatch({ type: 'RESET' })
    navigate('/', { replace: true })
  }

  // Celebration: fires once when the rep hits (or exceeds) their daily goal.
  // We wait for the async org-goal load before deciding — otherwise a rep with
  // a custom non-default goal could miss the confetti on the first paint, or
  // a rep who didn't quite hit a *lower* custom goal could falsely celebrate.
  const [celebrate, setCelebrate] = useState(false)
  const celebratedRef              = useRef(false)
  useEffect(() => {
    if (!goalReached || celebratedRef.current) return
    celebratedRef.current = true
    setCelebrate(true)
    // Haptic "zitter" — triple quick buzz + final flourish. navigator.vibrate
    // is a no-op on iOS Safari and desktop, which is fine; it's purely additive
    // on Android Chrome / PWAs where it's supported.
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([80, 40, 80, 40, 80, 60, 220])
      }
    } catch { /* some browsers throw when feature is disabled */ }
  }, [goalReached])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Goal-hit confetti (fires once, self-cleans when animation ends). */}
      <Confetti active={celebrate} />

      {/* Header */}
      <div className="px-5 pt-12 pb-6 text-center" style={{ backgroundColor: BRAND_GREEN }}>
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/20 mb-3">
          <CheckCircle className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-white text-2xl font-bold">Session Complete!</h1>
        <p className="text-blue-200 text-sm mt-1">{format(new Date(), 'EEEE, MMMM d')}</p>
      </div>

      <div className="flex-1 px-5 py-6 space-y-5 pb-24">

        {/* Goal Banner */}
        <div className={`rounded-2xl p-5 ${goalReached ? 'bg-amber-50 border-2 border-amber-300' : 'bg-white border border-gray-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-gray-700">Daily Goal Progress</span>
            <span className="font-bold text-lg">
              {goalReached ? '🏆 Goal Hit!' : goalProgressLabel}
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${goalPct}%`,
                backgroundColor: goalReached ? '#F59E0B' : BRAND_GREEN,
              }}
            />
          </div>
        </div>

        {/* Primary Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard
            icon={<Home className="w-5 h-5" />}
            label="Doors Knocked"
            value={stats.doors}
            sub={`${doorsPerHour}/hr`}
            color="blue"
          />
          <SummaryCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Revenue Booked"
            value={`$${stats.revenue.toFixed(0)}`}
            sub={`$${revenuePerHour}/hr`}
            color="green"
          />
          <SummaryCard
            icon={<Target className="w-5 h-5" />}
            label="Jobs Booked"
            value={stats.bookings}
            sub={`${closeRate}% close rate`}
            color="emerald"
          />
          <SummaryCard
            icon={<BarChart2 className="w-5 h-5" />}
            label="Estimates"
            value={stats.estimates}
            sub={`${stats.conversations} conversations`}
            color="amber"
          />
        </div>

        {/* Breakdown Table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50">
            <p className="font-semibold text-gray-700 text-sm">Session Breakdown</p>
          </div>
          {[
            ['Duration',              `${duration} min`],
            ['Doors / Hour',          doorsPerHour],
            ['Conversations',         stats.conversations],
            ['Estimates Requested',   stats.estimates],
            ['Jobs Booked',           stats.bookings],
            ['Revenue Booked',        `$${stats.revenue.toFixed(2)}`],
            ['Revenue / Hour',        `$${revenuePerHour}`],
            ['Bookings / 100 Doors',  stats.doors > 0 ? ((stats.bookings / stats.doors) * 100).toFixed(1) : '—'],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between px-5 py-2.5 border-b last:border-b-0">
              <span className="text-gray-600 text-sm">{label}</span>
              <span className="font-semibold text-gray-900 text-sm">{val}</span>
            </div>
          ))}
        </div>

        {/* Recent Interactions */}
        {state.interactions.length > 0 && (
          <div>
            <p className="font-semibold text-gray-700 text-sm mb-2">Interactions This Session</p>
            <div className="space-y-2">
              {state.interactions.map((intr, i) => (
                <InteractionRow key={i} interaction={intr} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-5 py-4">
        <button
          onClick={handleDone}
          className="w-full py-4 rounded-2xl text-white text-lg font-bold"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          Submit Day ✓
        </button>
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value, sub, color }) {
  const colors = {
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-500'   },
    green:   { bg: 'bg-green-50',   icon: 'text-green-600'  },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600'},
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600'  },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-2xl p-4`}>
      <div className={`${c.icon} mb-2`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

const OUTCOME_INFO = {
  no_answer:          { label: 'No Answer',      color: '#9CA3AF' },
  not_interested:     { label: 'Not Interested', color: '#EF4444' },
  estimate_requested: { label: 'Estimate',       color: '#F59E0B' },
  booked:             { label: 'Booked!',        color: '#10B981' },
}

// ─── Confetti ────────────────────────────────────────────────────────────────
// Lightweight canvas-based confetti with no extra dependency. Mounts a full-
// screen non-interactive <canvas>, runs a single rAF loop for ~3.5s, then
// clears. Particles launch from the center (primary burst) with a second
// burst shot from each bottom corner ~400ms later for a "cannon" feel.
function Confetti({ active, durationMs = 3500 }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return

    const W = () => window.innerWidth
    const H = () => window.innerHeight
    canvas.width  = W()
    canvas.height = H()
    const ctx = canvas.getContext('2d')

    const COLORS = ['#F5C542','#1B4FCC','#7DC31E','#EF4444','#F59E0B','#10B981','#8B5CF6','#EC4899']

    const makeBurst = (cx, cy, n, vxBias = 0) => {
      const out = []
      for (let i = 0; i < n; i++) {
        out.push({
          x: cx + (Math.random() - 0.5) * 60,
          y: cy + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 8 + vxBias,
          vy: -Math.random() * 9 - 5,
          g:  0.18 + Math.random() * 0.14,
          w:  5 + Math.random() * 6,
          h:  9 + Math.random() * 8,
          rot: Math.random() * Math.PI * 2,
          vr:  (Math.random() - 0.5) * 0.35,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          shape: Math.random() < 0.55 ? 'rect' : 'circle',
        })
      }
      return out
    }

    // Primary burst from the "Goal Hit!" banner region.
    const particles = makeBurst(W() / 2, H() * 0.22, Math.min(200, Math.floor(W() / 3.5)))

    let secondBurstFired = false
    const start = performance.now()
    let rafId = 0

    const tick = (now) => {
      const t = now - start
      ctx.clearRect(0, 0, W(), H())

      // Cannon bursts from the bottom corners after a short delay.
      if (!secondBurstFired && t > 400) {
        secondBurstFired = true
        const n = Math.min(90, Math.floor(W() / 7))
        particles.push(...makeBurst(W() * 0.06, H() * 0.78, n,  6))
        particles.push(...makeBurst(W() * 0.94, H() * 0.78, n, -6))
      }

      const fadeStart = durationMs - 700
      const alpha = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / 700)

      for (const p of particles) {
        p.vy += p.g
        p.vx *= 0.996
        p.x  += p.vx
        p.y  += p.vy
        p.rot += p.vr

        if (p.y - p.h > H()) continue  // off-screen, skip draw

        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        if (p.shape === 'rect') {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        } else {
          ctx.beginPath()
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.restore()
      }

      if (t < durationMs) {
        rafId = requestAnimationFrame(tick)
      } else {
        ctx.clearRect(0, 0, W(), H())
      }
    }
    rafId = requestAnimationFrame(tick)

    const onResize = () => {
      canvas.width  = W()
      canvas.height = H()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
    }
  }, [active, durationMs])

  if (!active) return null
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-50"
    />
  )
}

function InteractionRow({ interaction }) {
  const info = OUTCOME_INFO[interaction.outcome] || { label: interaction.outcome, color: '#9CA3AF' }
  return (
    <div className="bg-white rounded-xl px-4 py-3 border border-gray-100 flex items-center justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-700 truncate">{interaction.address || 'Unknown address'}</p>
        {interaction.contact_name && (
          <p className="text-xs text-gray-400 mt-0.5">{interaction.contact_name}</p>
        )}
      </div>
      <div className="ml-3 text-right">
        <span className="text-xs font-semibold px-2 py-1 rounded-full"
          style={{ color: info.color, backgroundColor: `${info.color}18` }}>
          {info.label}
        </span>
        {interaction.estimated_value && (
          <p className="text-xs text-green-600 font-semibold mt-1">${interaction.estimated_value}</p>
        )}
      </div>
    </div>
  )
}
