/**
 * ManagersSettings — owner-only screen for managing the manager roster and
 * each manager's pipeline-phase email subscriptions.
 *
 * Lives at /settings/managers. Reached from Settings → "Managers" tile
 * (which only renders for the org owner).
 *
 * Two manager tiers, mirroring the closer model:
 *
 *   • Email-only manager (default) — no auth account, no platform seat.
 *     Just receives the pipeline-phase emails they're subscribed to.
 *
 *   • Platform manager — full role='manager' account, logs into the
 *     manager dashboard. Takes a billable seat. Can also subscribe to
 *     phase emails.
 *
 * Every manager (including the owner) can be subscribed to any/all of three
 * pipeline phases:
 *   • Hot leads
 *   • Appointments & estimates  (appt_scheduled + estimate_sent, combined)
 *   • Booked
 *
 * Owner-only end to end: the route is reachable by any manager, but the
 * screen guards on ownership and the underlying RLS / edge-function checks
 * enforce it server-side too.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Users, Plus, X, Trash2, Send, Loader2, Check,
  Flame, CalendarCheck, CheckCircle2, Crown, ShieldAlert, DollarSign,
  UserPlus, ArrowDownCircle, Search,
} from 'lucide-react'
import {
  getCurrentUser, getMyOrganization,
  getAllManagersUnified,
  createManager,            // platform-tier add (seat)
  createManagerContact,     // email-only add
  updateManagerContact,
  deleteManagerContact,
  deleteManagerUser,
  updateManagerNotifyPhases,
  updateRepCommissionConfig,
  resendRepInvite,
  getPromotableReps,        // existing-rep picker source
  promoteRepToManager,
  demoteManagerToRep,
} from '../lib/supabase.js'
import CommissionEditor from '../components/CommissionEditor.jsx'
import { describeCommission } from '../lib/repStats.js'

const BRAND_BLUE = '#1B4FCC'

// The three subscribable phases + their display. 'appointment' is the
// combined appt_scheduled / estimate_sent toggle.
const PHASE_OPTIONS = [
  { id: 'hot_lead',    label: 'Hot leads',         icon: Flame        },
  { id: 'appointment', label: 'Appts & estimates', icon: CalendarCheck },
  { id: 'booked',      label: 'Booked',            icon: CheckCircle2 },
]

// New managers start subscribed to Booked only — the lightest-touch default
// (a manager "may only care when a job gets booked"). They can widen it with
// one tap per phase.
const DEFAULT_PHASES = ['booked']

export default function ManagersSettings() {
  const navigate = useNavigate()

  const [isOwner,   setIsOwner]   = useState(null)   // null = still loading
  const [managers,  setManagers]  = useState([])
  const [org,       setOrg]       = useState(null)
  const [commissionId, setCommissionId] = useState(null) // platform mgr whose rate is being edited
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [name,      setName]      = useState('')
  const [email,     setEmail]     = useState('')
  const [phone,     setPhone]     = useState('')
  // Third tier 'promote' opens a picker of existing reps instead of
  // the name/email/phone inputs — the owner clicks a rep, the RPC
  // flips users.role to 'manager' atomically.
  const [tier,      setTier]      = useState('contact')   // 'contact' | 'platform' | 'promote'
  const [adding,    setAdding]    = useState(false)
  const [busyId,    setBusyId]    = useState(null)
  const [toast,     setToast]     = useState(null)

  // Rep roster for the "Promote existing rep" picker. Loaded once when
  // the owner first opens the Add form; refreshed whenever a promotion
  // or demotion lands so the list stays in sync.
  const [repsRoster,   setRepsRoster]   = useState([])
  const [repsLoaded,   setRepsLoaded]   = useState(false)
  const [repSearch,    setRepSearch]    = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const [u, myOrg] = await Promise.all([getCurrentUser(), getMyOrganization()])
    const owner = u?.role === 'manager' && !!myOrg?.owner_user_id && myOrg.owner_user_id === u.id
    setOrg(myOrg)
    setIsOwner(owner)
    if (owner) setManagers(await getAllManagersUnified())
    setLoading(false)
  }

  async function load() {
    setManagers(await getAllManagersUnified())
  }

  async function loadRepsRoster() {
    setRepsRoster(await getPromotableReps())
    setRepsLoaded(true)
  }

  // Lazy-load the rep roster the first time the owner switches into
  // the "Promote existing rep" tier — keeps the screen fast for the
  // common case (most managers are added by email).
  useEffect(() => {
    if (showAdd && tier === 'promote' && !repsLoaded) {
      loadRepsRoster()
    }
  }, [showAdd, tier, repsLoaded])

  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 2600)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (tier !== 'promote' && (!name.trim() || !email.trim())) return
    setAdding(true)
    if (tier === 'contact') {
      const { error } = await createManagerContact({
        fullName: name, email, phone: phone || undefined, notifyPhases: DEFAULT_PHASES,
      })
      setAdding(false)
      if (error) { showToast(error.message || 'Add failed', 'error'); return }
      showToast('Manager added — emailed on Booked by default')
    } else if (tier === 'platform') {
      const { error, emailSent, emailError, user } = await createManager({
        fullName: name, email, phone: phone || undefined, mode: 'invite',
      })
      if (error) { setAdding(false); showToast(error.message || 'Invite failed', 'error'); return }
      // Seed the new platform manager's subscription so they start getting
      // Booked emails like email-only managers do. Best-effort.
      if (user?.id) await updateManagerNotifyPhases(user.id, DEFAULT_PHASES).catch(() => {})
      setAdding(false)
      showToast(emailSent ? 'Manager invited' : `Created. Email: ${emailError || 'failed'}`,
                emailSent ? 'success' : 'error')
    } else {
      // tier === 'promote' — handled by handlePromote() called from the
      // rep picker; reaching this branch via the form submit is a no-op
      // because there's no submit button when the picker is visible.
      setAdding(false)
      return
    }
    setName(''); setEmail(''); setPhone(''); setTier('contact')
    setShowAdd(false)
    await load()
  }

  // Promote an existing rep — invoked from the rep picker row.
  async function handlePromote(rep) {
    if (!rep?.id) return
    setBusyId(rep.id)
    const { error } = await promoteRepToManager(rep.id)
    setBusyId(null)
    if (error) { showToast(error.message || 'Promote failed', 'error'); return }
    showToast(`${rep.full_name || rep.email} is now a manager`)
    // Close the form, reset tier, and refresh both lists so the
    // promoted rep disappears from the picker and lands in the
    // manager roster with Booked as their default subscription.
    setShowAdd(false)
    setTier('contact')
    setRepSearch('')
    setRepsLoaded(false)
    await load()
  }

  // Demote a platform manager back to rep. Owner-only, owner-protected,
  // self-demote blocked — all enforced server-side. We still confirm at
  // the UI to make "I clicked the wrong button" recoverable.
  async function handleDemote(m) {
    if (m.is_owner) return
    if (!window.confirm(
      `Demote ${m.full_name || m.email} to a rep? They'll lose dashboard access ` +
      `and stop receiving pipeline emails. You can promote them back any time.`
    )) return
    setBusyId(m.id)
    const { error } = await demoteManagerToRep(m.id)
    setBusyId(null)
    if (error) { showToast(error.message || 'Demote failed', 'error'); return }
    showToast('Demoted to rep')
    setRepsLoaded(false)   // next time the picker opens, refresh
    await load()
  }

  async function handleDelete(m) {
    if (m.is_owner) return
    const label = m.tier === 'platform' ? 'platform manager' : 'email-only manager'
    if (!window.confirm(`Remove ${m.full_name || m.email} (${label})?`)) return
    setBusyId(m.id)
    const { error } = m.tier === 'platform'
      ? await deleteManagerUser(m.id)
      : await deleteManagerContact(m.id)
    setBusyId(null)
    if (error) { showToast(error.message || 'Delete failed', 'error'); return }
    showToast('Removed')
    await load()
  }

  async function handleResend(m) {
    setBusyId(m.id)
    const { error, emailSent } = await resendRepInvite(m.id)
    setBusyId(null)
    showToast((error || !emailSent) ? (error?.message || 'Resend failed') : 'Invite re-sent',
              (error || !emailSent) ? 'error' : 'success')
  }

  async function handlePhaseToggle(m, phase) {
    const has  = m.notify_phases.includes(phase)
    const next = has ? m.notify_phases.filter((p) => p !== phase) : [...m.notify_phases, phase]
    // Optimistic update keyed on tier+id (ids are unique per table but not
    // necessarily across tables).
    setManagers((ms) => ms.map((x) =>
      (x.tier === m.tier && x.id === m.id) ? { ...x, notify_phases: next } : x))
    const { error } = m.tier === 'platform'
      ? await updateManagerNotifyPhases(m.id, next)
      : await updateManagerContact(m.id, { notifyPhases: next })
    if (error) {
      showToast(error.message || 'Update failed', 'error')
      await load()
    }
  }

  // Save a platform manager's commission rule. A manager who also knocks gets
  // paid like any rep; the same RLS policy that lets a manager set a rep's
  // commission ("Managers update reps in their org") covers updating another
  // user row in the org, so no extra plumbing is needed server-side.
  async function handleSaveCommission(managerId, config) {
    const { data, error } = await updateRepCommissionConfig(managerId, config)
    if (error) { showToast('Could not save commission: ' + error.message, 'error'); return }
    setManagers((ms) => ms.map((m) =>
      (m.tier === 'platform' && m.id === managerId)
        ? { ...m, commission_config: data?.commission_config ?? config }
        : m))
    setCommissionId(null)
    showToast('Commission saved')
  }

  const commissionOn = !!org?.commission_enabled

  const platformCount = managers.filter((m) => m.tier === 'platform').length
  const contactCount  = managers.filter((m) => m.tier === 'contact').length

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div
        className="px-5 pt-10 pb-6"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back to settings"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">Settings · Managers</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">Managers</h1>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 pt-6 space-y-4">

        {/* Owner gate */}
        {isOwner === false ? (
          <div className="bg-white rounded-2xl border border-amber-200 p-6 text-center">
            <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-800">Owner only</p>
            <p className="text-[12px] text-gray-500 mt-1 leading-snug max-w-xs mx-auto">
              Only the account owner can add managers or change their notification settings.
            </p>
            <button
              onClick={() => navigate('/settings')}
              className="mt-4 px-4 py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: BRAND_BLUE }}
            >
              Back to Settings
            </button>
          </div>
        ) : (
          <>
            {/* Explainer */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 text-[12px] text-blue-900 leading-snug">
              <p className="font-bold mb-1">Two manager tiers</p>
              <p>
                <span className="font-semibold">Email-only managers</span> just receive pipeline emails — no
                login, no seat. <span className="font-semibold">Platform managers</span> log into the dashboard
                to review team performance and take a seat. Either way, pick exactly which pipeline phases email
                each person below.
              </p>
            </div>

            {/* Header row + add button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <Users className="w-4 h-4" style={{ color: BRAND_BLUE }} />
                <h2 className="text-sm font-bold text-gray-800">Your managers</h2>
                {contactCount > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {contactCount} email-only
                  </span>
                )}
                {platformCount > 0 && (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                    {platformCount} platform
                  </span>
                )}
              </div>
              {!showAdd && (
                <button
                  onClick={() => setShowAdd(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white flex items-center gap-1.5"
                  style={{ background: BRAND_BLUE }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add manager
                </button>
              )}
            </div>

            {/* Add form */}
            {showAdd && (
              <form
                onSubmit={handleAdd}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-900">Add a manager</p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdd(false); setName(''); setEmail(''); setPhone('')
                      setTier('contact'); setRepSearch('')
                    }}
                    className="text-gray-400 hover:text-gray-600"
                    aria-label="Cancel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <TierOption
                    id="contact"
                    active={tier === 'contact'}
                    onPick={setTier}
                    title="Email-only manager"
                    badge="Default · Free"
                    description="Receives the pipeline emails you choose. No login, no seat."
                  />
                  <TierOption
                    id="platform"
                    active={tier === 'platform'}
                    onPick={setTier}
                    title="Platform manager"
                    badge="Uses a seat"
                    description="Gets an invite to log into the dashboard and review team performance — plus any phase emails."
                  />
                  <TierOption
                    id="promote"
                    active={tier === 'promote'}
                    onPick={setTier}
                    title="Promote existing rep"
                    badge="No invite needed"
                    description="Pick a rep on your team — they keep their account but gain dashboard access. Reversible any time."
                  />
                </div>

                {/* Tier-specific body. 'contact' and 'platform' share
                    the name/email/phone inputs; 'promote' replaces
                    them with a searchable rep picker. */}
                {tier === 'promote' ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={repSearch}
                        onChange={(e) => setRepSearch(e.target.value)}
                        placeholder="Search reps by name or email…"
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                      />
                    </div>

                    {!repsLoaded ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                      </div>
                    ) : repsRoster.length === 0 ? (
                      <div className="text-center py-6 px-3 text-[12px] text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                        <Users className="w-6 h-6 text-gray-300 mx-auto mb-1.5" />
                        No reps on your team yet. Add a rep from Settings first, then come back to promote them.
                      </div>
                    ) : (() => {
                      const q = repSearch.trim().toLowerCase()
                      const filtered = q
                        ? repsRoster.filter((r) =>
                            (r.full_name || '').toLowerCase().includes(q) ||
                            (r.email || '').toLowerCase().includes(q))
                        : repsRoster
                      if (filtered.length === 0) return (
                        <p className="text-[12px] text-gray-500 text-center py-4">
                          No reps match "{repSearch}".
                        </p>
                      )
                      return (
                        <div className="max-h-72 overflow-y-auto space-y-1 -mx-1 px-1">
                          {filtered.map((r) => {
                            const busy = busyId === r.id
                            return (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => handlePromote(r)}
                                disabled={busy || adding}
                                className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-50 text-left"
                              >
                                <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center shrink-0">
                                  {(r.full_name || r.email || 'R')[0].toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[13px] font-semibold text-gray-900 truncate">{r.full_name || '—'}</p>
                                  <p className="text-[11px] text-gray-500 truncate">{r.email}</p>
                                </div>
                                <span className="text-[11px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 shrink-0"
                                  style={{ color: BRAND_BLUE, backgroundColor: '#EEF2FF' }}>
                                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                                  Promote
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })()}
                    <p className="text-[11px] text-gray-400 leading-snug">
                      Promoted reps get dashboard access immediately and start receiving Booked emails. You can demote them back at any time from the manager list below.
                    </p>
                  </div>
                ) : (
                  <>
                    <Input value={name}  onChange={setName}  placeholder="Full name"        required />
                    <Input value={email} onChange={setEmail} placeholder="Email address"    type="email" required />
                    <Input value={phone} onChange={setPhone} placeholder="Phone (optional)" type="tel" />

                    <button
                      type="submit"
                      disabled={adding || !name.trim() || !email.trim()}
                      className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ background: BRAND_BLUE }}
                    >
                      {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {tier === 'platform' ? 'Send manager invite' : 'Add manager'}
                    </button>
                  </>
                )}
              </form>
            )}

            {/* Manager list */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : managers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
                <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-700">No managers yet</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {managers.map((m) => (
                  <ManagerRow
                    key={`${m.tier}:${m.id}`}
                    manager={m}
                    busy={busyId === m.id}
                    commissionOn={commissionOn}
                    isEditingCommission={commissionId === m.id}
                    onEditCommission={() => setCommissionId(m.id)}
                    onCancelCommission={() => setCommissionId(null)}
                    onSaveCommission={(cfg) => handleSaveCommission(m.id, cfg)}
                    onResend={() => handleResend(m)}
                    onDelete={() => handleDelete(m)}
                    onDemote={() => handleDemote(m)}
                    onPhaseToggle={(p) => handlePhaseToggle(m, p)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className={`px-4 py-2 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2 ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
          }`}>
            {toast.type === 'success' && <Check className="w-4 h-4" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function TierOption({ id, active, onPick, title, badge, description }) {
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${
        active ? 'border-blue-600 bg-blue-50/60' : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
          active ? 'border-blue-600' : 'border-gray-300'
        }`}>
          {active && <span className="w-2 h-2 rounded-full bg-blue-600" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm font-semibold ${active ? 'text-blue-900' : 'text-gray-900'}`}>{title}</p>
            <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
              id === 'contact'  ? 'bg-green-100 text-green-700' :
              id === 'platform' ? 'bg-amber-100 text-amber-700' :
                                  'bg-blue-100 text-blue-700'
            }`}>
              {badge}
            </span>
          </div>
          <p className="text-[12px] text-gray-600 mt-0.5 leading-snug">{description}</p>
        </div>
      </div>
    </button>
  )
}

function Input({ value, onChange, placeholder, type = 'text', required }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
    />
  )
}

function ManagerRow({
  manager, busy, onResend, onDelete, onDemote, onPhaseToggle,
  commissionOn = false, isEditingCommission = false,
  onEditCommission, onCancelCommission, onSaveCommission,
}) {
  const isPlatform = manager.tier === 'platform'
  const phases = manager.notify_phases || []
  // Only platform managers can knock (email-only managers have no login), so
  // the commission control only makes sense for them — and only when the org
  // has commission tracking turned on.
  const showCommission = isPlatform && commissionOn
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
     <div className="p-3.5">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${
          isPlatform ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
        }`}>
          {(manager.full_name || manager.email || 'M')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{manager.full_name || '—'}</p>
            {manager.is_owner && (
              <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-0.5">
                <Crown className="w-2.5 h-2.5" /> Owner
              </span>
            )}
            <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
              isPlatform ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {isPlatform ? 'Platform' : 'Email-only'}
            </span>
          </div>
          <p className="text-[12px] text-gray-500 truncate">{manager.email}</p>
          {manager.phone && <p className="text-[11px] text-gray-400 truncate">{manager.phone}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isPlatform && !manager.is_owner && (
            <button
              onClick={onResend}
              disabled={busy}
              title="Resend invite email"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          )}
          {/* Demote to rep — platform managers only. Email-only
              "managers" don't have a user account to demote, and the
              owner is owner-protected server-side, so we hide the
              button for both. */}
          {isPlatform && !manager.is_owner && onDemote && (
            <button
              onClick={onDemote}
              disabled={busy}
              title="Demote to rep"
              className="p-2 rounded-lg text-amber-600 hover:bg-amber-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownCircle className="w-4 h-4" />}
            </button>
          )}
          {!manager.is_owner && (
            <button
              onClick={onDelete}
              disabled={busy}
              title={isPlatform ? 'Delete manager account' : 'Remove manager'}
              className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Phase subscription chips (multi-select) */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Email on</span>
        {PHASE_OPTIONS.map((opt) => {
          const active = phases.includes(opt.id)
          const Icon = opt.icon
          return (
            <button
              key={opt.id}
              onClick={() => onPhaseToggle(opt.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 border transition-colors ${
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          )
        })}
      </div>
      {phases.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-1.5">Not subscribed to any pipeline emails.</p>
      )}

      {/* Commission summary + edit entry point — platform managers only.
          A manager who also canvasses is paid like a rep; the owner sets
          their rule here. */}
      {showCommission && !isEditingCommission && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[10px] uppercase font-bold tracking-wider text-gray-400 mb-1.5">
            Canvassing commission
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 shrink-0" style={{ color: manager.commission_config ? BRAND_BLUE : '#9CA3AF' }} />
              <span className="text-[12px] font-medium truncate" style={{ color: manager.commission_config ? BRAND_BLUE : '#9CA3AF' }}>
                {manager.commission_config ? describeCommission(manager.commission_config) : 'No commission set'}
              </span>
            </div>
            <button
              onClick={onEditCommission}
              className="text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0"
              style={{ color: BRAND_BLUE, backgroundColor: '#EEF2FF' }}
            >
              {manager.commission_config ? 'Edit rate' : 'Set rate'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">
            Applies only to doors this manager knocks themselves while an active participant in a canvassing
            session — it doesn't pay out on their team's results.
          </p>
        </div>
      )}
     </div>

      {showCommission && isEditingCommission && (
        <CommissionEditor
          initialConfig={manager.commission_config}
          onSave={onSaveCommission}
          onCancel={onCancelCommission}
        />
      )}
    </div>
  )
}
