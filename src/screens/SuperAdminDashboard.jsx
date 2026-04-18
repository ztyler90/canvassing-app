/**
 * Super-Admin Dashboard
 * Only visible to users with `is_super_admin = true` (Zach).
 *
 * Shows every organization in the KnockIQ platform: current tier, seat count,
 * monthly revenue, and controls to switch any org's tier (Standard $20/seat
 * vs Pro $50/seat). This is the first visible piece of Phase 1 — the rest of
 * the app is unchanged for single-tenant users.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, formatDistanceToNow } from 'date-fns'
import { ChevronLeft, Building2, DollarSign, Users, CheckCircle, Shield, TrendingUp, TrendingDown, Loader, ChevronRight, Activity, AlertTriangle, AlertOctagon, LineChart as LineChartIcon, UserCheck, Percent } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getAllOrganizations,
  getOrganizationBilling,
  getOrganizationMemberCounts,
  getOrganizationInsightsSummary,
  getPlatformMetrics,
  updateOrganizationTier,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

const SEAT_PRICE = { standard: 20, pro: 50 }

export default function SuperAdminDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [orgs, setOrgs]         = useState([])
  const [billing, setBilling]   = useState([])
  const [memberCounts, setMC]   = useState({})
  const [insights, setInsights] = useState({})
  const [platform, setPlatform] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [updatingId, setUpdating] = useState(null)
  const [toast, setToast]       = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [o, b, m, i, p] = await Promise.all([
      getAllOrganizations(),
      getOrganizationBilling(),
      getOrganizationMemberCounts(),
      getOrganizationInsightsSummary(),
      getPlatformMetrics(),
    ])
    setOrgs(o)
    setBilling(b)
    setMC(m)
    setInsights(i || {})
    setPlatform(p || null)
    setLoading(false)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  async function handleSetTier(orgId, tier) {
    setUpdating(orgId)
    const { error } = await updateOrganizationTier(orgId, tier)
    setUpdating(null)
    if (error) {
      showToast('Failed to update tier: ' + error.message, 'error')
    } else {
      showToast(`Tier updated to ${tier === 'pro' ? 'Pro' : 'Standard'}`)
      loadData()
    }
  }

  // ── Derived totals ─────────────────────────────────────────────────────────
  const billingByOrg = Object.fromEntries(billing.map(b => [b.id, b]))
  const totalMRR     = billing.reduce((s, b) => s + (Number(b.monthly_price)    || 0), 0)
  const totalSeats   = billing.reduce((s, b) => s + (Number(b.active_seat_count) || 0), 0)
  const totalOrgs    = orgs.length
  const activeOrgs7d = Object.values(insights).filter(i => i.sessions_7d > 0).length
  const atRiskCount  = Object.values(insights).filter(i => i.health === 'at-risk' || i.health === 'churning').length

  // Guard: non super-admins should never see this page
  if (!user?.is_super_admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-sm text-center">
          <Shield className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-gray-700 font-semibold">Restricted</p>
          <p className="text-gray-400 text-xs mt-1">You don't have permission to view this page.</p>
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
      <Loader className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm font-medium shadow-lg ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="px-5 pt-12 pb-5" style={{ backgroundColor: BRAND_BLUE }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-white/20">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-white/80" />
              <p className="text-blue-200 text-xs font-medium">Super-Admin</p>
            </div>
            <h1 className="text-white font-bold text-lg">Platform Overview</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-6 pb-10 max-w-3xl mx-auto w-full">

        {/* ── Platform stats ──────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3">
          <StatCard
            icon={<Building2 className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
            label="Organizations"
            value={totalOrgs}
            sub={totalSeats ? `${totalSeats} seats` : null}
          />
          <StatCard
            icon={<UserCheck className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
            label="Total reps"
            value={platform?.totalReps ?? 0}
            sub={totalOrgs ? `Across ${totalOrgs} org${totalOrgs === 1 ? '' : 's'}` : null}
          />
          <StatCard
            icon={<Activity className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
            label="Active this week"
            value={`${activeOrgs7d}`}
            sub={totalOrgs ? `${Math.round((activeOrgs7d / totalOrgs) * 100)}% activation` : null}
          />
          <StatCard
            icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
            label="At risk / churning"
            value={atRiskCount}
            sub={atRiskCount ? 'Needs attention' : 'All healthy'}
            warn={atRiskCount > 0}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" style={{ color: BRAND_LIME }} />}
            label="MRR"
            value={`$${(platform?.currentMrr ?? totalMRR).toLocaleString()}`}
            accent
          />
          <StatCard
            icon={<DollarSign className="w-4 h-4" style={{ color: BRAND_LIME }} />}
            label="Projected ARR"
            value={`$${(platform?.projectedArr ?? totalMRR * 12).toLocaleString()}`}
            sub="MRR × 12"
            accent
          />
        </section>

        {/* ── MRR trend + growth strip ────────────────────────────────────── */}
        <section className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <LineChartIcon className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              <p className="text-gray-700 font-semibold text-sm">MRR · last 90 days</p>
            </div>
            <span className="text-gray-400 text-[10px] uppercase tracking-wide font-semibold">
              Churn {platform?.churnPct ?? 0}%
            </span>
          </div>
          <MrrLineChart data={platform?.mrrByDay || []} />
          <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-medium mb-4">
            <span>90d ago</span>
            <span>60d ago</span>
            <span>30d ago</span>
            <span>Today</span>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-3 border-t border-gray-100">
            <GrowthTile label="Daily"   pct={platform?.growth?.daily   ?? 0} />
            <GrowthTile label="Weekly"  pct={platform?.growth?.weekly  ?? 0} />
            <GrowthTile label="Monthly" pct={platform?.growth?.monthly ?? 0} />
            <GrowthTile label="Annual"  pct={platform?.growth?.annual  ?? 0} />
          </div>
        </section>

        {/* ── Organization list ───────────────────────────────────────────── */}
        <section>
          <h2 className="text-gray-700 font-semibold text-base mb-3">All Organizations</h2>
          <div className="space-y-3">
            {orgs.length === 0 && (
              <div className="bg-white rounded-2xl px-4 py-6 text-center border border-gray-100 shadow-sm">
                <Building2 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-gray-500 text-sm font-medium">No organizations yet</p>
                <p className="text-gray-400 text-xs mt-0.5">New tenants will appear here.</p>
              </div>
            )}
            {orgs.map(org => {
              const bill      = billingByOrg[org.id]
              const seats     = bill?.active_seat_count ?? memberCounts[org.id] ?? 0
              const mrr       = Number(bill?.monthly_price) || seats * (SEAT_PRICE[org.tier] || 0)
              const isPro     = org.tier === 'pro'
              const active    = org.status === 'active'
              const orgInsight = insights[org.id] || null
              return (
                <div key={org.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  {/* Top row: name + status + drill-in */}
                  <button
                    onClick={() => navigate(`/super-admin/org/${org.id}`)}
                    className="w-full flex items-start justify-between mb-3 text-left group">
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-gray-800 text-base truncate group-hover:text-blue-700 transition">
                          {org.name}
                        </p>
                        {orgInsight && <HealthPill status={orgInsight.health} />}
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5">
                        Created {format(new Date(org.created_at), 'MMM d, yyyy')}
                        {' · '}
                        {orgInsight?.last_activity_at
                          ? <>Last active {formatDistanceToNow(new Date(orgInsight.last_activity_at), { addSuffix: true })}</>
                          : <span className="text-gray-400">No activity yet</span>
                        }
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: active ? BRAND_LIME + '20' : '#FEE2E2',
                          color:            active ? '#166534'        : '#991B1B',
                        }}>
                        {active ? 'Active' : org.status}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-600 transition" />
                    </div>
                  </button>

                  {/* Engagement row — the new part the user asked for */}
                  {orgInsight ? (
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      <InsightStat label="Active reps" value={`${orgInsight.active_reps_7d}/${orgInsight.total_reps}`} />
                      <InsightStat label="Doors 7d"   value={orgInsight.doors_7d.toLocaleString()}  trend={orgInsight.doors_trend_pct} />
                      <InsightStat label="Revenue 7d" value={`$${Math.round(orgInsight.revenue_7d).toLocaleString()}`} trend={orgInsight.revenue_trend_pct} accent />
                      <InsightStat label="Sessions"   value={orgInsight.sessions_7d} />
                    </div>
                  ) : null}

                  {/* Plan / billing row */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MiniStat label="Seats"  value={seats} />
                    <MiniStat label="$/seat" value={`$${SEAT_PRICE[org.tier] ?? 0}`} />
                    <MiniStat label="MRR"    value={`$${mrr.toLocaleString()}`} accent />
                  </div>

                  {/* Tier switch */}
                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mr-1">Tier</p>
                    <button
                      onClick={() => !isPro ? null : handleSetTier(org.id, 'standard')}
                      disabled={updatingId === org.id || !isPro}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition ${
                        !isPro
                          ? 'border-blue-500 text-blue-600 bg-blue-50'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}>
                      {!isPro && <CheckCircle className="w-3 h-3 inline mr-1" />}
                      Standard · $20/seat
                    </button>
                    <button
                      onClick={() => isPro ? null : handleSetTier(org.id, 'pro')}
                      disabled={updatingId === org.id || isPro}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border-2 transition ${
                        isPro
                          ? 'border-blue-500 text-blue-600 bg-blue-50'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}>
                      {isPro && <CheckCircle className="w-3 h-3 inline mr-1" />}
                      Pro · $50/seat
                    </button>
                    {updatingId === org.id && <Loader className="w-4 h-4 animate-spin text-blue-500" />}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Footer note ─────────────────────────────────────────────────── */}
        <p className="text-center text-gray-400 text-xs pt-2">
          Tier changes take effect immediately and are tracked in <code className="font-mono text-gray-500">organization_tier_history</code>.
        </p>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub, accent, warn }) {
  const borderCls =
    warn   ? 'border-amber-200'  :
    accent ? 'border-green-200'  : 'border-gray-100'
  const valueCls =
    warn   ? 'text-amber-700' :
    accent ? 'text-green-700' : 'text-gray-800'
  return (
    <div className={`bg-white rounded-2xl p-3 shadow-sm border ${borderCls}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-gray-400 text-[10px] uppercase tracking-wide font-semibold">{label}</p>
      </div>
      <p className={`font-bold text-lg ${valueCls}`}>{value}</p>
      {sub && <p className="text-gray-400 text-[11px] font-medium mt-0.5">{sub}</p>}
    </div>
  )
}

function MiniStat({ label, value, accent }) {
  return (
    <div className="bg-gray-50 rounded-xl px-2 py-2 text-center">
      <p className="text-gray-400 text-[10px] uppercase tracking-wide font-medium">{label}</p>
      <p className={`font-bold text-sm mt-0.5 ${accent ? 'text-green-700' : 'text-gray-800'}`}>{value}</p>
    </div>
  )
}

/** Per-org inline KPI (used in the engagement row of each org card). */
function InsightStat({ label, value, trend, accent }) {
  return (
    <div className="bg-gray-50 rounded-xl px-2 py-2 text-center">
      <p className="text-gray-400 text-[9px] uppercase tracking-wide font-semibold">{label}</p>
      <p className={`font-bold text-sm mt-0.5 tabular-nums ${accent ? 'text-green-700' : 'text-gray-800'}`}>
        {value}
      </p>
      {trend !== undefined && (
        <div className={`inline-flex items-center gap-0.5 text-[10px] font-semibold mt-0.5 ${
          trend > 0  ? 'text-green-700' :
          trend < 0  ? 'text-red-600'   : 'text-gray-400'
        }`}>
          {trend > 0 && <TrendingUp  className="w-2.5 h-2.5" />}
          {trend < 0 && <TrendingDown className="w-2.5 h-2.5" />}
          <span>{trend > 0 ? '+' : ''}{trend}%</span>
        </div>
      )}
    </div>
  )
}

/** 90-day MRR line chart with filled area. */
function MrrLineChart({ data }) {
  if (!data?.length) return <div className="h-24 grid place-items-center text-gray-300 text-xs">No MRR history yet</div>
  const w = 600
  const h = 110
  const values = data.map(d => d.mrr)
  const max = Math.max(1, ...values)
  const min = Math.min(...values)
  const step = w / Math.max(1, data.length - 1)
  const pts = values.map((v, i) => [i * step, h - ((v - Math.min(0, min)) / (max - Math.min(0, min) || 1)) * (h - 12) - 6])
  const pathLine = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPath = `M0,${h} L${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} L${w},${h} Z`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-24 block">
      <defs>
        <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#1B4FCC" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#1B4FCC" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#mrrFill)" />
      <polyline points={pathLine} fill="none" stroke="#1B4FCC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#1B4FCC" stroke="white" strokeWidth="1.5" />
    </svg>
  )
}

/** Single growth-% tile (daily/weekly/monthly/annual). */
function GrowthTile({ label, pct }) {
  const isUp = pct > 0
  const isDown = pct < 0
  const tone = isUp ? 'text-green-700' : isDown ? 'text-red-600' : 'text-gray-500'
  const bg   = isUp ? 'bg-green-50' : isDown ? 'bg-red-50' : 'bg-gray-50'
  return (
    <div className={`rounded-xl px-2 py-2 text-center ${bg}`}>
      <p className="text-gray-400 text-[10px] uppercase tracking-wide font-semibold">{label}</p>
      <div className={`flex items-center justify-center gap-1 font-bold text-sm tabular-nums mt-0.5 ${tone}`}>
        {isUp   && <TrendingUp   className="w-3 h-3" />}
        {isDown && <TrendingDown className="w-3 h-3" />}
        <span>{isUp ? '+' : ''}{pct}%</span>
      </div>
    </div>
  )
}

/** Health chip used next to each org name. */
function HealthPill({ status }) {
  const styles = {
    healthy:  { bg: BRAND_LIME + '25', fg: '#14532D', text: 'Healthy' },
    'at-risk':{ bg: '#FEF3C7',         fg: '#92400E', text: 'At risk' },
    churning: { bg: '#FEE2E2',         fg: '#991B1B', text: 'Churning' },
  }
  const s = styles[status] || styles.healthy
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
      style={{ backgroundColor: s.bg, color: s.fg }}>
      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: s.fg }} />
      {s.text}
    </span>
  )
}
