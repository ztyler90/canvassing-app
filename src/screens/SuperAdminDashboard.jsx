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
import { format } from 'date-fns'
import { ChevronLeft, Building2, DollarSign, Users, CheckCircle, Shield, TrendingUp, Loader } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  getAllOrganizations,
  getOrganizationBilling,
  getOrganizationMemberCounts,
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
  const [loading, setLoading]   = useState(true)
  const [updatingId, setUpdating] = useState(null)
  const [toast, setToast]       = useState(null)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [o, b, m] = await Promise.all([
      getAllOrganizations(),
      getOrganizationBilling(),
      getOrganizationMemberCounts(),
    ])
    setOrgs(o)
    setBilling(b)
    setMC(m)
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
  const totalMRR     = billing.reduce((s, b) => s + (Number(b.monthly_revenue) || 0), 0)
  const totalSeats   = billing.reduce((s, b) => s + (Number(b.seat_count)      || 0), 0)
  const totalOrgs    = orgs.length

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
        <section className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<Building2 className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
            label="Organizations"
            value={totalOrgs}
          />
          <StatCard
            icon={<Users className="w-4 h-4" style={{ color: BRAND_BLUE }} />}
            label="Total seats"
            value={totalSeats}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" style={{ color: BRAND_LIME }} />}
            label="MRR"
            value={`$${totalMRR.toLocaleString()}`}
            accent
          />
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
              const bill   = billingByOrg[org.id]
              const seats  = bill?.seat_count ?? memberCounts[org.id] ?? 0
              const mrr    = Number(bill?.monthly_revenue) || seats * (SEAT_PRICE[org.tier] || 0)
              const isPro  = org.tier === 'pro'
              const active = org.status === 'active'
              return (
                <div key={org.id} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                  {/* Top row: name + status */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 text-base truncate">{org.name}</p>
                      <p className="text-gray-400 text-xs mt-0.5">
                        Created {format(new Date(org.created_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: active ? BRAND_LIME + '20' : '#FEE2E2',
                        color:            active ? '#166534'        : '#991B1B',
                      }}>
                      {active ? 'Active' : org.status}
                    </span>
                  </div>

                  {/* Middle row: stats */}
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

function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`bg-white rounded-2xl p-3 shadow-sm border ${accent ? 'border-green-200' : 'border-gray-100'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-gray-400 text-[10px] uppercase tracking-wide font-semibold">{label}</p>
      </div>
      <p className={`font-bold text-lg ${accent ? 'text-green-700' : 'text-gray-800'}`}>{value}</p>
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
