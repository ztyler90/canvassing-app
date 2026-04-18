/**
 * OrganizationDetail — super-admin drill-in for a single sub-account.
 *
 * Reached from SuperAdminDashboard by tapping any org card. Shows engagement
 * metrics, last-activity timing, per-rep activity breakdown, a 30-day active-
 * rep line chart, health signals, billing, and a recent activity timeline.
 *
 * Data flow:
 *   - getOrganizationDetail(orgId) returns { org, users, sessions, recentInteractions, billing }
 *   - Everything downstream is derived here (no further fetches).
 *
 * Protected by the super-admin route gate in App.jsx.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ChevronLeft, Shield, Users, Clock, DollarSign, Activity, TrendingUp,
  TrendingDown, CheckCircle, AlertTriangle, AlertOctagon, CreditCard, MapPin, Sparkles,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { getOrganizationDetail } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

const SEAT_PRICE = { standard: 20, pro: 50 }

export default function OrganizationDetail() {
  const { orgId } = useParams()
  const navigate  = useNavigate()
  const { user }  = useAuth()

  const [loading, setLoading] = useState(true)
  const [detail,  setDetail]  = useState(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setNotFound(false)
      const d = await getOrganizationDetail(orgId)
      if (cancelled) return
      if (!d?.org) { setNotFound(true); setLoading(false); return }
      setDetail(d)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [orgId])

  // ── Guard: non super-admins should never see this page ─────────────────────
  if (!user?.is_super_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-sm text-center">
          <Shield className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-700 font-semibold">Restricted</p>
          <p className="text-gray-400 text-xs mt-1">
            You don't have permission to view this page.
          </p>
          <button
            onClick={() => navigate('/manager')}
            className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
            style={{ backgroundColor: BRAND_BLUE }}>
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <p className="text-gray-800 font-semibold">Organization not found</p>
      <p className="text-gray-500 text-sm mt-1">
        It may have been removed or the link is incorrect.
      </p>
      <button
        onClick={() => navigate('/super-admin')}
        className="mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
        style={{ backgroundColor: BRAND_BLUE }}>
        Back
      </button>
    </div>
  )

  const { org, users, sessions, recentInteractions, billing } = detail

  // ── Derived metrics ────────────────────────────────────────────────────────
  const now = Date.now()
  const since7  = now -  7 * 86400000
  const since30 = now - 30 * 86400000

  const reps = users.filter((u) => u.role === 'rep' || u.role === 'manager')
  const sessions7d  = sessions.filter((s) => new Date(s.started_at).getTime() >= since7)
  const sessionsPrev7d = sessions.filter((s) => {
    const t = new Date(s.started_at).getTime()
    return t >= since7 - 7 * 86400000 && t < since7
  })

  const activeRepIds7d = new Set(sessions7d.map((s) => s.rep_id))
  const activeRepCount = activeRepIds7d.size

  const agg7d = sessions7d.reduce((a, s) => ({
    doors:     a.doors     + (s.doors_knocked || 0),
    convos:    a.convos    + (s.conversations || 0),
    estimates: a.estimates + (s.estimates     || 0),
    bookings:  a.bookings  + (s.bookings      || 0),
    revenue:   a.revenue   + Number(s.revenue_booked || 0),
  }), { doors: 0, convos: 0, estimates: 0, bookings: 0, revenue: 0 })

  const aggPrev7d = sessionsPrev7d.reduce((a, s) => ({
    doors:   a.doors   + (s.doors_knocked || 0),
    revenue: a.revenue + Number(s.revenue_booked || 0),
  }), { doors: 0, revenue: 0 })

  const doorsTrend   = pctChange(agg7d.doors,   aggPrev7d.doors)
  const revenueTrend = pctChange(agg7d.revenue, aggPrev7d.revenue)

  const lastActivity = sessions.length ? sessions[0].started_at : null
  const lastActivityLabel = lastActivity
    ? formatDistanceToNow(new Date(lastActivity), { addSuffix: true })
    : 'Never'
  const lastActivityHoursAgo = lastActivity
    ? (now - new Date(lastActivity).getTime()) / 3600000
    : Infinity

  // ── Health signals ─────────────────────────────────────────────────────────
  const signals = buildHealthSignals({
    lastActivityHoursAgo,
    activeRepCount,
    totalReps: reps.length,
    doorsTrend,
    revenueTrend,
    sessions7d: sessions7d.length,
    status: org.status,
  })
  const worstSeverity = signals.reduce((worst, s) => {
    const rank = { ok: 0, warn: 1, bad: 2 }
    return rank[s.severity] > rank[worst] ? s.severity : worst
  }, 'ok')
  const overallHealth =
    worstSeverity === 'bad' ? 'churning' :
    worstSeverity === 'warn' ? 'at-risk' : 'healthy'

  // ── Top reps (by revenue this week) ────────────────────────────────────────
  const repStats = {}
  for (const u of reps) {
    repStats[u.id] = {
      id: u.id,
      full_name: u.full_name || u.email,
      avatar_url: u.avatar_url,
      role: u.role,
      doors: 0, convos: 0, estimates: 0, bookings: 0, revenue: 0, sessions: 0,
      last_session_at: null,
    }
  }
  for (const s of sessions7d) {
    const r = repStats[s.rep_id]; if (!r) continue
    r.doors     += s.doors_knocked  || 0
    r.convos    += s.conversations  || 0
    r.estimates += s.estimates      || 0
    r.bookings  += s.bookings       || 0
    r.revenue   += Number(s.revenue_booked) || 0
    r.sessions  += 1
    if (!r.last_session_at || s.started_at > r.last_session_at) {
      r.last_session_at = s.started_at
    }
  }
  const topReps = Object.values(repStats)
    .sort((a, b) => b.revenue - a.revenue || b.doors - a.doors)
    .slice(0, 5)

  // ── Daily active reps — last 30 days (for the sparkline chart) ─────────────
  const dailyActiveReps = (() => {
    const buckets = new Array(30).fill(null).map(() => new Set())
    for (const s of sessions) {
      const t = new Date(s.started_at).getTime()
      const dayIdx = Math.floor((t - since30) / 86400000)
      if (dayIdx >= 0 && dayIdx < 30) buckets[dayIdx].add(s.rep_id)
    }
    return buckets.map((b) => b.size)
  })()

  const avgDaily = dailyActiveReps.length
    ? (dailyActiveReps.reduce((a, b) => a + b, 0) / dailyActiveReps.length).toFixed(1)
    : '0'
  const peakDaily = Math.max(0, ...dailyActiveReps)

  // ── Timeline (10 most recent events: sessions + interactions merged) ───────
  const timeline = [
    ...sessions.slice(0, 12).map((s) => ({
      id: `s-${s.id}`,
      time: s.started_at,
      kind: 'session',
      text: `${labelForRep(reps, s.rep_id)} started session${
        s.neighborhood ? ` in ${s.neighborhood}` : ''
      } · ${s.doors_knocked || 0} doors`,
    })),
    ...recentInteractions.slice(0, 8).filter((i) => i.outcome === 'booked').map((i) => ({
      id: `i-${i.id}`,
      time: i.created_at,
      kind: 'booking',
      text: `${labelForRep(reps, i.rep_id)} booked ${
        i.address || 'an estimate'
      }${i.estimated_value ? ` · +$${Number(i.estimated_value).toLocaleString()}` : ''}`,
    })),
  ]
    .sort((a, b) => (b.time > a.time ? 1 : -1))
    .slice(0, 10)

  // ── Render ─────────────────────────────────────────────────────────────────
  const monthlyPrice = Number(billing?.monthly_price) ||
    (activeRepCount * (SEAT_PRICE[org.tier] || 0))

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-10">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-5 pt-12 pb-5" style={{ backgroundColor: BRAND_BLUE }}>
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/super-admin')}
            className="p-2 rounded-full bg-white/20 shrink-0">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-white/80" />
              <p className="text-blue-200 text-xs font-medium">Sub-Account</p>
            </div>
            <h1 className="text-white font-bold text-lg truncate">{org.name}</h1>
            <p className="text-blue-100 text-xs mt-0.5">
              Created {format(new Date(org.created_at), 'MMM d, yyyy')}
              {' · '}
              <span className="font-semibold">
                {org.tier === 'pro' ? 'Pro' : 'Standard'}
              </span>
            </p>
          </div>
          <HealthPill status={overallHealth} />
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-5 max-w-3xl mx-auto w-full">

        {/* ── KPI tiles ───────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3">
          <KpiTile
            icon={<Users className="w-4 h-4 text-blue-600" />}
            label="Active reps · 7d"
            value={`${activeRepCount}`}
            unit={`of ${reps.length}`}
            sub={activeRepCount >= reps.length && reps.length > 0 ? 'All active' : null}
          />
          <KpiTile
            icon={<Clock className="w-4 h-4 text-blue-600" />}
            label="Last activity"
            value={lastActivity ? shortRelative(lastActivity) : '—'}
            sub={lastActivity ? format(new Date(lastActivity), 'MMM d, h:mm a') : 'No sessions yet'}
          />
          <KpiTile
            icon={<Activity className="w-4 h-4 text-blue-600" />}
            label="Sessions · 7d"
            value={`${sessions7d.length}`}
            sub={trendLabel(doorsTrend, 'doors')}
            trend={doorsTrend}
          />
          <KpiTile
            icon={<DollarSign className="w-4 h-4 text-green-600" />}
            label="Revenue · 7d"
            value={`$${agg7d.revenue.toLocaleString()}`}
            sub={trendLabel(revenueTrend, 'vs last wk')}
            trend={revenueTrend}
            accent
          />
        </section>

        {/* ── Daily active reps chart ─────────────────────────────────────── */}
        <section className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-gray-400 text-[10px] uppercase tracking-wide font-semibold">
                Daily active reps · 30 days
              </p>
              <p className="text-gray-800 font-semibold text-sm mt-0.5">
                Avg {avgDaily} / day · Peak {peakDaily}
              </p>
            </div>
          </div>
          <Sparkline data={dailyActiveReps} />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-medium">
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </section>

        {/* ── Top reps ────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-gray-700 font-semibold text-base">
              Top reps · this week
            </h2>
            <p className="text-gray-400 text-xs">{reps.length} total</p>
          </div>
          {topReps.length === 0 ? (
            <div className="bg-white rounded-2xl px-4 py-6 text-center border border-gray-100 shadow-sm">
              <p className="text-gray-500 text-sm font-medium">No rep activity this week</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Activity from the sales reps on this sub-account will show here.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              {topReps.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 p-3">
                  <div
                    className="w-7 h-7 rounded-lg grid place-items-center font-bold text-[11px]"
                    style={{
                      backgroundColor: i === 0 ? BRAND_LIME + '20' : '#F3F4F6',
                      color:           i === 0 ? '#166534'         : '#6B7280',
                    }}>
                    {i + 1}
                  </div>
                  <RepAvatar rep={r} />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-800 font-semibold text-sm truncate">
                      {r.full_name}
                      {r.role === 'manager' && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-blue-600 font-bold">
                          mgr
                        </span>
                      )}
                    </p>
                    <p className="text-gray-400 text-[11px] mt-0.5">
                      {r.doors} doors · {r.convos} convos · {r.bookings} bookings
                    </p>
                  </div>
                  <p className="text-green-700 font-bold text-sm tabular-nums">
                    ${r.revenue.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Health signals ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-gray-700 font-semibold text-base mb-2.5">
            Health signals
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {signals.map((s, i) => (
              <div key={i} className="flex items-start gap-3 p-3">
                <SignalIcon severity={s.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-800 text-sm font-medium leading-snug">{s.text}</p>
                  {s.detail && (
                    <p className="text-gray-400 text-xs mt-0.5 leading-snug">{s.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Plan & billing ──────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-gray-700 font-semibold text-base">Plan &amp; billing</h2>
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: org.status === 'active' ? BRAND_LIME + '20' : '#FEE2E2',
                color:            org.status === 'active' ? '#166534'         : '#991B1B',
              }}>
              {org.status || '—'}
            </span>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <BillingRow label="Plan" value={`${org.tier === 'pro' ? 'Pro' : 'Standard'} · $${SEAT_PRICE[org.tier] ?? 0}/seat`} />
            <BillingRow label="Active seats" value={billing?.active_seat_count ?? reps.length} />
            <BillingRow label="Monthly revenue" value={`$${monthlyPrice.toLocaleString()}`} accent />
            <BillingRow label="Trial ends" value={billing?.trial_ends_at ? format(new Date(billing.trial_ends_at), 'MMM d, yyyy') : '—'} last />
          </div>
        </section>

        {/* ── Recent activity timeline ────────────────────────────────────── */}
        <section>
          <h2 className="text-gray-700 font-semibold text-base mb-2.5">
            Recent activity
          </h2>
          {timeline.length === 0 ? (
            <div className="bg-white rounded-2xl px-4 py-6 text-center border border-gray-100 shadow-sm">
              <p className="text-gray-500 text-sm font-medium">Nothing recent</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Sessions and bookings from this org will appear here.
              </p>
            </div>
          ) : (
            <ol className="border-l-2 border-gray-200 pl-4 ml-1.5 space-y-3">
              {timeline.map((ev) => (
                <li key={ev.id} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 ${
                      ev.kind === 'booking' ? 'border-green-500' : 'border-blue-500'
                    }`}
                  />
                  <p className="text-gray-400 text-[11px] font-medium">
                    {formatDistanceToNow(new Date(ev.time), { addSuffix: true })}
                  </p>
                  <p className="text-gray-700 text-[13px] mt-0.5 leading-snug">{ev.text}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

      </div>
    </div>
  )
}

/* ─── Small UI pieces ─────────────────────────────────────────────────────── */

function KpiTile({ icon, label, value, unit, sub, trend, accent }) {
  return (
    <div className={`bg-white rounded-2xl p-3.5 border ${accent ? 'border-green-200' : 'border-gray-100'} shadow-sm`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-gray-400 text-[10px] uppercase tracking-wide font-semibold">{label}</p>
      </div>
      <div className="flex items-baseline gap-1">
        <p className={`font-bold text-xl tabular-nums ${accent ? 'text-green-700' : 'text-gray-800'}`}>
          {value}
        </p>
        {unit && <p className="text-gray-400 text-xs font-semibold">{unit}</p>}
      </div>
      {sub && (
        <div className={`flex items-center gap-1 text-[11px] font-medium mt-0.5 ${
          trend === undefined ? 'text-gray-500' :
          trend > 0  ? 'text-green-700' :
          trend < 0  ? 'text-red-600' : 'text-gray-500'
        }`}>
          {trend !== undefined && trend > 0 && <TrendingUp className="w-3 h-3" />}
          {trend !== undefined && trend < 0 && <TrendingDown className="w-3 h-3" />}
          <span>{sub}</span>
        </div>
      )}
    </div>
  )
}

function HealthPill({ status }) {
  const styles = {
    healthy:  { bg: BRAND_LIME + '30', fg: '#14532D', text: 'Healthy' },
    'at-risk':{ bg: '#FEF3C7',         fg: '#92400E', text: 'At risk' },
    churning: { bg: '#FEE2E2',         fg: '#991B1B', text: 'Churning' },
  }
  const s = styles[status] || styles.healthy
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold self-start"
      style={{ backgroundColor: s.bg, color: s.fg }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.fg }} />
      {s.text}
    </span>
  )
}

function SignalIcon({ severity }) {
  if (severity === 'bad') return <div className="w-5 h-5 rounded-full bg-red-500 grid place-items-center shrink-0 mt-0.5"><AlertOctagon className="w-3 h-3 text-white" /></div>
  if (severity === 'warn') return <div className="w-5 h-5 rounded-full bg-amber-500 grid place-items-center shrink-0 mt-0.5"><AlertTriangle className="w-3 h-3 text-white" /></div>
  return <div className="w-5 h-5 rounded-full bg-green-500 grid place-items-center shrink-0 mt-0.5"><CheckCircle className="w-3 h-3 text-white" /></div>
}

function RepAvatar({ rep }) {
  if (rep.avatar_url) {
    return <img src={rep.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
  }
  const initials = (rep.full_name || '?')
    .split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <div
      className="w-8 h-8 rounded-full grid place-items-center text-white font-bold text-[11px] shrink-0"
      style={{ backgroundColor: BRAND_BLUE }}>
      {initials}
    </div>
  )
}

function BillingRow({ label, value, accent, last }) {
  return (
    <div className={`flex items-center justify-between py-2 ${last ? '' : 'border-b border-dashed border-gray-100'}`}>
      <span className="text-gray-500 text-sm">{label}</span>
      <span className={`font-bold text-sm tabular-nums ${accent ? 'text-green-700' : 'text-gray-800'}`}>{value}</span>
    </div>
  )
}

/** Inline 30-point sparkline with filled area. */
function Sparkline({ data }) {
  if (!data?.length) return <div className="h-16" />
  const w = 420
  const h = 72
  const max = Math.max(1, ...data)
  const step = w / Math.max(1, data.length - 1)
  const pts = data.map((v, i) => [i * step, h - (v / max) * (h - 8) - 4])
  const path = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `M0,${h} L${path.replace(/ /g, ' L')} L${w},${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16 block">
      <defs>
        <linearGradient id="orgEngFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#10B981" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#orgEngFill)" />
      <polyline points={path} fill="none" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="#10B981" />
    </svg>
  )
}

/* ─── Utilities ───────────────────────────────────────────────────────────── */

function pctChange(curr, prev) {
  if (!prev) return curr > 0 ? 100 : 0
  return Math.round(((curr - prev) / prev) * 100)
}

function shortRelative(iso) {
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000
  if (hours < 1)  return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 24) return `${Math.round(hours)}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

function trendLabel(pct, suffix) {
  const sign = pct > 0 ? '▲' : pct < 0 ? '▼' : '—'
  return `${sign} ${Math.abs(pct)}% ${suffix}`
}

function labelForRep(reps, repId) {
  const r = reps.find((u) => u.id === repId)
  return r?.full_name || r?.email || 'A rep'
}

function buildHealthSignals({
  lastActivityHoursAgo, activeRepCount, totalReps,
  doorsTrend, revenueTrend, sessions7d, status,
}) {
  const signals = []

  if (lastActivityHoursAgo === Infinity) {
    signals.push({
      severity: 'bad',
      text: 'No canvassing activity on record',
      detail: 'Nobody from this sub-account has started a session yet.',
    })
  } else if (lastActivityHoursAgo < 24) {
    signals.push({
      severity: 'ok',
      text: 'Activity within the last 24 hours',
      detail: `Most recent session ${Math.max(1, Math.round(lastActivityHoursAgo * 60))} minutes ago.`,
    })
  } else if (lastActivityHoursAgo < 72) {
    signals.push({
      severity: 'warn',
      text: `Last activity ${Math.round(lastActivityHoursAgo / 24)} days ago`,
      detail: 'Engagement is slowing — consider a check-in.',
    })
  } else {
    signals.push({
      severity: 'bad',
      text: `No activity in ${Math.round(lastActivityHoursAgo / 24)} days`,
      detail: 'This account is likely churning.',
    })
  }

  if (totalReps === 0) {
    signals.push({
      severity: 'warn',
      text: 'No reps invited yet',
      detail: 'The manager hasn\'t added any sales reps to this sub-account.',
    })
  } else if (activeRepCount === 0) {
    signals.push({
      severity: 'bad',
      text: `0 of ${totalReps} reps active this week`,
      detail: 'The team is signed up but nobody has run a session in the last 7 days.',
    })
  } else if (activeRepCount < totalReps) {
    signals.push({
      severity: 'warn',
      text: `${totalReps - activeRepCount} rep${totalReps - activeRepCount === 1 ? '' : 's'} inactive this week`,
      detail: `${activeRepCount} of ${totalReps} are canvassing.`,
    })
  } else {
    signals.push({
      severity: 'ok',
      text: 'All reps active this week',
      detail: `${totalReps} of ${totalReps} have run at least one session.`,
    })
  }

  if (sessions7d > 0) {
    if (doorsTrend >= 15) {
      signals.push({
        severity: 'ok',
        text: 'Doors trending up',
        detail: `+${doorsTrend}% vs last week — momentum is strong.`,
      })
    } else if (doorsTrend <= -20) {
      signals.push({
        severity: 'warn',
        text: 'Doors trending down',
        detail: `${doorsTrend}% vs last week — may need intervention.`,
      })
    }

    if (revenueTrend >= 15) {
      signals.push({
        severity: 'ok',
        text: 'Revenue trending up',
        detail: `+${revenueTrend}% vs last week.`,
      })
    } else if (revenueTrend <= -25) {
      signals.push({
        severity: 'warn',
        text: 'Revenue dropped sharply',
        detail: `${revenueTrend}% vs last week.`,
      })
    }
  }

  if (status && status !== 'active') {
    signals.push({
      severity: 'warn',
      text: `Account status: ${status}`,
      detail: 'Subscription isn\'t in an "active" state.',
    })
  }

  return signals
}
