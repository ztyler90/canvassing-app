/**
 * Settings — manager settings page with pricing info and CRM integration.
 * Accessible from ManagerDashboard → gear icon in header.
 *
 * Features:
 *  - Pricing display: Standard ($20/mo) vs Pro ($70/mo)
 *  - Zapier webhook URL configuration (Pro feature)
 *  - Future CRM options (Coming Soon)
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Zap, Check, ExternalLink, Lock, CheckCircle, XCircle, Loader, Users, UserPlus, Trash2, Building2, Shield, DollarSign, Plus, X, Target, Hash, Mail, Send, Phone, Key, Copy, MessageSquare, RefreshCw } from 'lucide-react'
import { saveWebhookUrl, getWebhookUrl, fireZapierWebhook, getCurrentUser, getAllReps, createRep, deleteRep, resendRepInvite, getMyOrganization, updateRepCommissionConfig, updateOrganizationGoal } from '../lib/supabase.js'
import { describeCommission, DEFAULT_COMMISSION_CONFIG } from '../lib/repStats.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

export default function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const teamSectionRef = useRef(null)
  const [user, setUser]               = useState(null)
  const [org, setOrg]                 = useState(null)
  const [webhookUrl, setWebhookUrl]   = useState('')
  const [savedUrl, setSavedUrl]       = useState('')
  const [saving, setSaving]           = useState(false)
  const [testing, setTesting]         = useState(false)
  const [testResult, setTestResult]   = useState(null) // 'success' | 'error' | null
  const [toast, setToast]             = useState(null)
  const [loading, setLoading]         = useState(true)

  // Team management state
  const [reps, setReps]               = useState([])
  const [showAddRep, setShowAddRep]   = useState(false)
  const [newRepName, setNewRepName]   = useState('')
  const [newRepEmail, setNewRepEmail] = useState('')
  const [newRepPhone, setNewRepPhone] = useState('')
  // Onboarding flow is temp-password-only for now. The email-invite path
  // (magic link via Resend) has been disabled in the UI until we wire up
  // a verified sending domain — see ONBOARDING_EMAIL_SETUP.md. The edge
  // function still supports `mode: 'invite'`, so re-enabling is a UI-only
  // change when the time comes. `resend_invite` on existing reps is
  // unaffected; it stays in the rep list as an optional escape hatch.
  const [newRepPassword, setNewRepPassword] = useState('')
  const [showTempPass, setShowTempPass] = useState(false)
  const [addingRep, setAddingRep]     = useState(false)
  const [deletingRepId, setDeletingRepId] = useState(null)
  const [resendingRepId, setResendingRepId] = useState(null)   // rep id currently being re-invited
  const [commissionRepId, setCommissionRepId] = useState(null) // rep whose commission is being edited
  // Credentials panel — shown after a successful temp-password create so
  // the manager can copy the password and/or fire off a pre-filled SMS.
  // { fullName, email, phone, password, loginUrl } | null
  const [pendingCreds, setPendingCreds] = useState(null)

  // Daily goal config — hydrated from org on load, edited in-place.
  const [goalType,     setGoalType]     = useState('revenue')  // 'revenue' | 'count'
  const [goalValue,    setGoalValue]    = useState('1000')
  const [countLabel,   setCountLabel]   = useState('estimates') // 'estimates' | 'appointments'
  const [savingGoal,   setSavingGoal]   = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  // If Settings was opened with { state: { openAddRep: true } } — typically
  // from the Manager Dashboard "Add Rep" button on the Reps tab — auto-open
  // the Add Rep form and scroll the Team section into view so the manager
  // lands right where they need to be.
  useEffect(() => {
    if (location.state?.openAddRep) {
      setShowAddRep(true)
      // Scroll after paint so the section ref is mounted and sized.
      requestAnimationFrame(() => {
        teamSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      // Clear the state so a subsequent browser-back doesn't re-trigger it.
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSettings() {
    const [u, repList, myOrg] = await Promise.all([
      getCurrentUser(),
      getAllReps(),
      getMyOrganization(),
    ])
    setUser(u)
    setReps(repList)
    setOrg(myOrg)
    if (myOrg) {
      setGoalType(myOrg.daily_goal_type || 'revenue')
      setGoalValue(String(myOrg.daily_goal_value ?? 1000))
      setCountLabel(myOrg.count_goal_label || 'estimates')
    }
    const url = await getWebhookUrl()
    if (url) {
      setWebhookUrl(url)
      setSavedUrl(url)
    }
    setLoading(false)
  }

  async function handleSaveGoal() {
    if (!org?.id) return
    const num = Number(goalValue)
    if (!Number.isFinite(num) || num < 0) {
      showToast('Enter a valid non-negative number', 'error'); return
    }
    setSavingGoal(true)
    const { data, error } = await updateOrganizationGoal(org.id, {
      type:       goalType,
      value:      num,
      countLabel: countLabel,
    })
    setSavingGoal(false)
    if (error) {
      showToast('Could not save goal: ' + error.message, 'error')
    } else {
      setOrg(data)
      showToast('Daily goal updated')
    }
  }

  async function handleAddRep() {
    const name  = newRepName.trim()
    const mail  = newRepEmail.trim()
    const phone = newRepPhone.trim()
    const pass  = newRepPassword
    if (!name || !mail) {
      showToast('Name and email are required.', 'error'); return
    }
    if (!pass || pass.length < 8) {
      showToast('Temporary password must be at least 8 characters.', 'error'); return
    }
    setAddingRep(true)
    const { user: created, loginUrl, error } = await createRep({
      fullName: name,
      email:    mail,
      phone:    phone || null,
      mode:     'temp_password',
      password: pass,
    })
    setAddingRep(false)
    if (error) {
      showToast('Failed to create rep: ' + error.message, 'error')
      return
    }
    setReps(prev => [...prev, {
      id: created.id, email: created.email, full_name: created.full_name,
      phone: created.phone || null, role: 'rep',
    }])

    // Reset the form — but keep the section expanded until the manager
    // dismisses the creds panel.
    setNewRepName(''); setNewRepEmail(''); setNewRepPhone(''); setNewRepPassword('')
    setShowTempPass(false)

    // Surface credentials so the manager can copy/SMS them. The password
    // is plaintext here by design — it's the only moment we can show it,
    // and the manager explicitly asked for it. Once the rep logs in,
    // force_password_change rotates them to their own.
    setPendingCreds({
      fullName: created.full_name,
      email:    created.email,
      phone:    created.phone || phone || '',
      password: pass,
      loginUrl: loginUrl || `${window.location.origin}/login`,
    })
    setShowAddRep(false)
    showToast(`${created.full_name} added — deliver the credentials below.`)
  }

  // Generate a readable ~13-character temp password in camelCase:
  // two English words (capitalized) + 4 digits, e.g. "QuickPanda9174".
  //
  // Why camelCase instead of hyphen-separated ("quick-panda-9174"):
  // iOS/Android treat '-' as a word boundary, so a rep who receives
  // the credentials over SMS can't double-tap the password to copy
  // it — they'd only grab one chunk and have to long-press-drag the
  // rest. camelCase keeps the whole thing as a single "word" for
  // mobile text selection while staying easy to dictate verbally
  // ("quick panda nine-one-seven-four"). Readable enough for manual
  // typing, strong enough to clear Supabase's 6-char minimum (the
  // edge function enforces 8+). The rep rotates it on first login,
  // so entropy is a secondary concern here.
  function generateTempPassword() {
    const adjectives = ['Brisk', 'Sunny', 'Quick', 'Brave', 'Lucky', 'Merry', 'Quiet', 'Mighty', 'Clever', 'Snappy']
    const animals    = ['Otter', 'Finch', 'Lynx',  'Raven', 'Panda', 'Tiger', 'Koala', 'Zebra',  'Moose',  'Fox']
    const a = adjectives[Math.floor(Math.random() * adjectives.length)]
    const n = animals[Math.floor(Math.random() * animals.length)]
    const d = String(Math.floor(1000 + Math.random() * 9000))
    return `${a}${n}${d}`
  }

  async function handleResendInvite(rep) {
    setResendingRepId(rep.id)
    const { emailSent, emailError, error } = await resendRepInvite(rep.id)
    setResendingRepId(null)
    if (error) {
      showToast('Could not resend invite: ' + error.message, 'error')
    } else if (emailSent) {
      showToast(`Invite resent to ${rep.email}`)
    } else {
      showToast(
        `Invite link regenerated but email send failed` +
        (emailError ? `: ${emailError}` : '') + '.',
        'error',
      )
    }
  }

  async function handleDeleteRep(rep) {
    if (!window.confirm(`Remove ${rep.full_name} from your team? Their session history will be retained.`)) return
    setDeletingRepId(rep.id)
    const { error } = await deleteRep(rep.id)
    setDeletingRepId(null)
    if (error) {
      showToast('Could not remove rep: ' + error.message, 'error')
    } else {
      setReps(prev => prev.filter(r => r.id !== rep.id))
      showToast(`${rep.full_name} removed.`)
    }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleSaveCommission(repId, config) {
    const { data, error } = await updateRepCommissionConfig(repId, config)
    if (error) {
      showToast('Could not save commission: ' + error.message, 'error')
      return false
    }
    setReps(prev => prev.map(r => r.id === repId ? { ...r, commission_config: data?.commission_config ?? config } : r))
    setCommissionRepId(null)
    showToast('Commission updated')
    return true
  }

  async function handleSaveWebhook() {
    setSaving(true)
    const { error } = await saveWebhookUrl(webhookUrl.trim() || null)
    setSaving(false)
    if (error) {
      showToast('Failed to save: ' + error.message, 'error')
    } else {
      setSavedUrl(webhookUrl.trim())
      showToast('Webhook URL saved!')
    }
  }

  async function handleTestWebhook() {
    if (!savedUrl) { showToast('Save your webhook URL first', 'error'); return }
    setTesting(true)
    setTestResult(null)
    const payload = {
      event: 'test',
      source: 'knockiq',
      timestamp: new Date().toISOString(),
      message: 'KnockIQ webhook test — connection successful!',
    }
    const ok = await fireZapierWebhook(savedUrl, payload)
    setTesting(false)
    setTestResult(ok ? 'success' : 'error')
    setTimeout(() => setTestResult(null), 4000)
  }

  // Phase 1: tier comes from the organization row (source of truth).
  // Fallback to legacy user.plan during rollout.
  const isPro       = (org?.tier || user?.plan) === 'pro'
  const seatPrice   = isPro ? 50 : 20
  const monthlyCost = (reps.length + 1) * seatPrice  // +1 for the owner
  const roleLabel   = user?.is_super_admin ? 'Super-Admin' : (user?.role === 'manager' ? 'Owner' : 'Rep')

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm font-medium shadow-lg ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-12 pb-5 bg-brand-header">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-white/20">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <p className="text-blue-200 text-xs">KnockIQ</p>
            <h1 className="text-white font-bold text-lg">Settings & Billing</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-6 pb-10 max-w-lg mx-auto w-full">

        {/* ── Pricing Plans ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-gray-700 font-semibold text-base mb-3">Plans</h2>
          <div className="space-y-3">

            {/* Standard Plan */}
            <div className={`bg-white rounded-2xl p-4 shadow-sm border-2 ${!isPro ? 'border-blue-500' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-bold text-gray-800 text-base">Standard</p>
                  <p className="text-gray-500 text-xs">For growing canvassing teams</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800 text-xl">$20<span className="text-sm font-normal text-gray-500">/seat/mo</span></p>
                  <p className="text-gray-400 text-xs">Billed monthly</p>
                </div>
              </div>
              <ul className="space-y-1.5 mt-3">
                {['Unlimited reps', 'Session tracking', 'GPS mapping', 'Territory management', 'Leaderboard & analytics'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 flex-shrink-0" style={{ color: BRAND_LIME }} />
                    {f}
                  </li>
                ))}
              </ul>
              {!isPro && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="inline-flex items-center gap-1.5 text-blue-600 text-xs font-semibold bg-blue-50 px-3 py-1 rounded-full">
                    <CheckCircle className="w-3.5 h-3.5" /> Current Plan
                  </span>
                </div>
              )}
            </div>

            {/* Pro Plan */}
            <div className={`rounded-2xl p-4 shadow-sm border-2 ${isPro ? 'border-blue-500 bg-white' : 'bg-white border-gray-100'}`}
              style={isPro ? {} : {}}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-800 text-base">Pro</p>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: BRAND_LIME }}>
                      + CRM
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs">Standard + CRM integration add-on</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800 text-xl">$50<span className="text-sm font-normal text-gray-500">/seat/mo</span></p>
                  <p className="text-gray-400 text-xs">Replaces Standard price</p>
                </div>
              </div>
              <ul className="space-y-1.5 mt-3">
                {['Everything in Standard', 'Zapier webhook integration', 'Auto-push session data to any CRM', 'Custom field mapping (coming soon)', 'Priority support'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 flex-shrink-0" style={{ color: BRAND_LIME }} />
                    {f}
                  </li>
                ))}
              </ul>
              {isPro ? (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="inline-flex items-center gap-1.5 text-blue-600 text-xs font-semibold bg-blue-50 px-3 py-1 rounded-full">
                    <CheckCircle className="w-3.5 h-3.5" /> Current Plan
                  </span>
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <a
                    href="mailto:hello@knockiq.com?subject=Upgrade to Pro&body=Hi, I'd like to upgrade my account to the Pro plan."
                    className="btn-brand block w-full py-2.5 rounded-xl text-center text-sm font-bold">
                    Contact to Upgrade → Pro
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── CRM Integration ────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-gray-700 font-semibold text-base">CRM Integration</h2>
            {!isPro && <Lock className="w-3.5 h-3.5 text-gray-400" />}
          </div>

          {/* Zapier */}
          <div className={`bg-white rounded-2xl p-4 shadow-sm border ${isPro ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                <span className="text-xl">⚡</span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800 text-sm">Zapier Webhook</p>
                <p className="text-gray-400 text-xs">Connect to 6,000+ apps via Zapier</p>
              </div>
              <a
                href="https://zapier.com/apps/webhooks"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-blue-500 hover:underline">
                Docs <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {isPro ? (
              <div className="space-y-3">
                <div>
                  <label className="text-gray-500 text-xs block mb-1.5">Webhook URL</label>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={e => setWebhookUrl(e.target.value)}
                    placeholder="https://hooks.zapier.com/hooks/catch/…"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <p className="text-gray-400 text-xs mt-1.5">
                    Fires when a rep ends a session — sends the full session summary.
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleTestWebhook}
                    disabled={testing || !savedUrl}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium disabled:opacity-40">
                    {testing
                      ? <><Loader className="w-4 h-4 animate-spin" /> Testing…</>
                      : testResult === 'success'
                        ? <><CheckCircle className="w-4 h-4 text-green-500" /> Sent!</>
                        : testResult === 'error'
                          ? <><XCircle className="w-4 h-4 text-red-500" /> Failed</>
                          : 'Test'}
                  </button>
                  <button
                    onClick={handleSaveWebhook}
                    disabled={saving || webhookUrl === savedUrl}
                    className="btn-brand flex-1 py-2 rounded-xl text-sm font-bold">
                    {saving ? 'Saving…' : 'Save URL'}
                  </button>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500">
                  <p className="font-semibold text-gray-600 mb-1">Payload sent on session end:</p>
                  <pre className="overflow-x-auto text-gray-400">{`{
  "event": "session_ended",
  "rep_name": "…",
  "rep_email": "…",
  "started_at": "…",
  "ended_at": "…",
  "doors_knocked": 0,
  "conversations": 0,
  "estimates": 0,
  "bookings": 0,
  "revenue_booked": 0.00
}`}</pre>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
                <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <p className="text-gray-500 text-sm">Upgrade to Pro to configure Zapier webhooks.</p>
              </div>
            )}
          </div>
        </section>

        {/* ── Team Management ────────────────────────────────────────── */}
        <section ref={teamSectionRef}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              <h2 className="text-gray-700 font-semibold text-base">Team</h2>
              <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {reps.length} rep{reps.length !== 1 ? 's' : ''}
              </span>
            </div>
            <button
              onClick={() => setShowAddRep(v => !v)}
              className="btn-brand flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold">
              <UserPlus className="w-3.5 h-3.5" />
              Add Rep
            </button>
          </div>

          {/* Credentials panel — rendered after a temp-password create
              so the manager can copy the password and/or fire off a
              pre-filled SMS to the rep. Dismissing it doesn't undo
              anything; the rep is already created. */}
          {pendingCreds && (
            <CredentialsPanel
              creds={pendingCreds}
              onCopyToast={(m, type) => showToast(m, type)}
              onDismiss={() => setPendingCreds(null)}
            />
          )}

          {/* Add Rep form */}
          {showAddRep && (
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-blue-200 mb-3 space-y-3">
              <div className="flex items-start justify-between">
                <p className="text-sm font-semibold text-gray-700">New Rep Account</p>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Added to monthly bill</p>
                  <p className="text-base font-bold" style={{ color: BRAND_BLUE }}>
                    +${seatPrice}<span className="text-xs font-normal text-gray-500">/mo</span>
                  </p>
                  <p className="text-xs text-gray-400">{reps.length + 1} rep{reps.length + 1 !== 1 ? 's' : ''} total</p>
                </div>
              </div>

              {/* Email-invite flow is disabled for now — the Add Rep form
                  goes straight into the temp-password setup. See the
                  state comment above handleAddRep. */}

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Full Name</label>
                <input
                  type="text"
                  value={newRepName}
                  onChange={e => setNewRepName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Email</label>
                <input
                  type="email"
                  inputMode="email"
                  value={newRepEmail}
                  onChange={e => setNewRepEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">
                  Phone <span className="text-gray-300 font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={newRepPhone}
                  onChange={e => setNewRepPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Add a phone so you can text the credentials straight from the confirmation panel.
                </p>
              </div>

              {/* Temp password — always shown, with a "Generate" button
                  that fills a readable two-word password and a show/hide
                  toggle. */}
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Temporary Password</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showTempPass ? 'text' : 'password'}
                      value={newRepPassword}
                      onChange={e => setNewRepPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="off"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTempPass(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-500 px-2 py-1 rounded-md hover:bg-gray-100">
                      {showTempPass ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setNewRepPassword(generateTempPassword()); setShowTempPass(true) }}
                    className="flex items-center gap-1.5 px-3 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Generate
                  </button>
                </div>
              </div>

              {/* Explainer — keeps the manager oriented on what happens
                  after they click Create. */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <Key className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  We'll show the password once so you can text it to {newRepName.trim() || 'the rep'}.
                  They'll be prompted to pick their own on first login — nothing is stored in plaintext afterwards.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddRep(false)
                    setNewRepName(''); setNewRepEmail(''); setNewRepPhone('')
                    setNewRepPassword(''); setShowTempPass(false)
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium">
                  Cancel
                </button>
                <button
                  onClick={handleAddRep}
                  disabled={addingRep}
                  className="btn-brand flex-1 py-2.5 rounded-xl text-sm font-bold">
                  {addingRep ? 'Creating rep…' : 'Create & Show Credentials'}
                </button>
              </div>
            </div>
          )}

          {/* Rep list */}
          <div className="space-y-2">
            {reps.length === 0 && !showAddRep && (
              <div className="bg-white rounded-2xl px-4 py-6 text-center border border-gray-100 shadow-sm">
                <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-gray-500 text-sm font-medium">No reps yet</p>
                <p className="text-gray-400 text-xs mt-0.5">Tap "Add Rep" to create your first canvasser account.</p>
              </div>
            )}
            {reps.map(rep => {
              const isEditing = commissionRepId === rep.id
              return (
                <div key={rep.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                        style={{ background: 'linear-gradient(135deg, #2E6BFF 0%, #6D28D9 100%)' }}>
                        {(rep.full_name || rep.email || '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{rep.full_name || '—'}</p>
                        <p className="text-xs text-gray-400 truncate">{rep.email}</p>
                        <p className="text-[11px] font-medium mt-0.5" style={{ color: rep.commission_config ? BRAND_BLUE : '#9CA3AF' }}>
                          <DollarSign className="inline w-3 h-3 -mt-0.5" />
                          {rep.commission_config ? describeCommission(rep.commission_config) : 'No commission set'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleResendInvite(rep)}
                        disabled={resendingRepId === rep.id}
                        title="Resend invite email"
                        className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-40 transition-colors">
                        {resendingRepId === rep.id
                          ? <Loader className="w-4 h-4 animate-spin" />
                          : <Send className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => setCommissionRepId(isEditing ? null : rep.id)}
                        className="p-2 rounded-xl text-xs font-semibold"
                        style={{ color: isEditing ? '#9CA3AF' : BRAND_BLUE, backgroundColor: isEditing ? '#F3F4F6' : '#EFF6FF' }}>
                        {isEditing ? <X className="w-4 h-4" /> : 'Commission'}
                      </button>
                      <button
                        onClick={() => handleDeleteRep(rep)}
                        disabled={deletingRepId === rep.id}
                        className="p-2 rounded-xl text-red-400 hover:bg-red-50 disabled:opacity-40 transition-colors">
                        {deletingRepId === rep.id
                          ? <Loader className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {isEditing && (
                    <CommissionEditor
                      initialConfig={rep.commission_config}
                      onSave={(cfg) => handleSaveCommission(rep.id, cfg)}
                      onCancel={() => setCommissionRepId(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Daily Goal ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-gray-700 font-semibold text-base">Daily Goal</h2>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
            <p className="text-gray-500 text-xs">
              Sets the "Today's Goal" target your reps see at the top of their home screen.
            </p>

            {/* Goal type segmented control */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">
                Goal Type
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setGoalType('revenue')}
                  className={`py-2.5 rounded-xl text-sm font-semibold border-2 flex items-center justify-center gap-1.5 transition-colors ${
                    goalType === 'revenue'
                      ? 'text-white'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                  style={
                    goalType === 'revenue'
                      ? { background: 'linear-gradient(135deg, #2E6BFF 0%, #1B4FCC 100%)', borderColor: BRAND_BLUE }
                      : undefined
                  }
                >
                  <DollarSign className="w-4 h-4" />
                  Revenue
                </button>
                <button
                  type="button"
                  onClick={() => setGoalType('count')}
                  className={`py-2.5 rounded-xl text-sm font-semibold border-2 flex items-center justify-center gap-1.5 transition-colors ${
                    goalType === 'count'
                      ? 'text-white'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                  style={
                    goalType === 'count'
                      ? { background: 'linear-gradient(135deg, #2E6BFF 0%, #1B4FCC 100%)', borderColor: BRAND_BLUE }
                      : undefined
                  }
                >
                  <Hash className="w-4 h-4" />
                  {countLabel === 'appointments' ? 'Appointments' : 'Estimates'}
                </button>
              </div>
            </div>

            {/* Terminology toggle — only meaningful when goal type is count,
                but we still let managers set it while in revenue mode so the
                funnel chart and future labels match their company's language. */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">
                Terminology
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCountLabel('estimates')}
                  className={`py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    countLabel === 'estimates'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  Estimates
                </button>
                <button
                  type="button"
                  onClick={() => setCountLabel('appointments')}
                  className={`py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    countLabel === 'appointments'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  Appointments
                </button>
              </div>
              <p className="text-gray-400 text-[11px] mt-1.5">
                Some teams say "Estimates", others say "Appointments". This changes the wording reps see.
              </p>
            </div>

            {/* Target value input */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">
                Daily Target
              </p>
              <div className="flex items-center gap-2">
                {goalType === 'revenue' && (
                  <span className="text-gray-500 text-sm font-semibold">$</span>
                )}
                <input
                  type="number"
                  min="0"
                  step={goalType === 'revenue' ? '50' : '1'}
                  value={goalValue}
                  onChange={(e) => setGoalValue(e.target.value)}
                  className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold focus:border-blue-400 focus:outline-none"
                  placeholder={goalType === 'revenue' ? '1000' : '3'}
                />
                <span className="text-gray-500 text-sm font-medium whitespace-nowrap">
                  {goalType === 'revenue'
                    ? 'per day'
                    : `${countLabel === 'appointments' ? 'appts' : 'ests'}/day`}
                </span>
              </div>
              <p className="text-gray-400 text-[11px] mt-1.5">
                {goalType === 'revenue'
                  ? 'Reps see their revenue booked today vs. this target.'
                  : `Reps see their ${countLabel} booked today vs. this target.`}
              </p>
            </div>

            <button
              onClick={handleSaveGoal}
              disabled={savingGoal}
              className="btn-brand w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              {savingGoal ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Goal
                </>
              )}
            </button>
          </div>
        </section>

        {/* ── Organization & Billing ─────────────────────────────────── */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-gray-700 font-semibold text-base">Organization</h2>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-gray-500 text-sm">Business</p>
              <p className="text-gray-800 text-sm font-semibold">{org?.name || '—'}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-gray-500 text-sm">Tier</p>
              <span className="text-sm font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: isPro ? BRAND_LIME + '20' : '#EFF6FF', color: isPro ? '#166534' : BRAND_BLUE }}>
                {isPro ? 'Pro' : 'Standard'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-gray-500 text-sm">Seats</p>
              <p className="text-gray-800 text-sm font-medium">
                {reps.length + 1} <span className="text-gray-400 text-xs font-normal">(1 owner + {reps.length} rep{reps.length !== 1 ? 's' : ''})</span>
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <p className="text-gray-500 text-sm">Monthly cost</p>
              <p className="font-bold text-base" style={{ color: BRAND_BLUE }}>
                ${monthlyCost.toLocaleString()}<span className="text-xs font-normal text-gray-500">/mo</span>
              </p>
            </div>
            <p className="text-gray-400 text-xs pt-1">
              ${seatPrice}/seat × {reps.length + 1} seats · {isPro ? 'Pro tier' : 'Standard tier'}
            </p>
          </div>
        </section>

        {/* ── Account ────────────────────────────────────────────────── */}
        <section className="pb-6">
          <h2 className="text-gray-700 font-semibold text-base mb-3">Account</h2>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-gray-500 text-sm">Name</p>
              <p className="text-gray-800 text-sm font-medium">{user?.full_name || '—'}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-gray-500 text-sm">Email</p>
              <p className="text-gray-800 text-sm font-medium">{user?.email || '—'}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-gray-500 text-sm">Role</p>
              <span className="text-sm font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                style={{ backgroundColor: user?.is_super_admin ? '#FEF3C7' : '#EFF6FF', color: user?.is_super_admin ? '#92400E' : BRAND_BLUE }}>
                {user?.is_super_admin && <Shield className="w-3 h-3" />}
                {roleLabel}
              </span>
            </div>
          </div>
          {user?.is_super_admin && (
            <button
              onClick={() => navigate('/super-admin')}
              className="btn-brand mt-3 w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
              <Shield className="w-4 h-4" />
              Open Super-Admin Dashboard
            </button>
          )}
          <p className="text-center text-gray-400 text-xs mt-4">
            Questions?{' '}
            <a href="mailto:hello@knockiq.com" className="text-blue-500 hover:underline">
              hello@knockiq.com
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}

/* ── Commission Editor ──────────────────────────────────────────────────────
 * Inline editor below a rep's row in the Team list. Lets the manager pick
 * one of three commission structures and save it to users.commission_config.
 */
function CommissionEditor({ initialConfig, onSave, onCancel }) {
  const seed = initialConfig || DEFAULT_COMMISSION_CONFIG
  const [type, setType]           = useState(seed.type || 'flat_pct')
  const [flatPct, setFlatPct]     = useState(seed.type === 'flat_pct'    ? seed.value ?? 0 : 10)
  const [perBook, setPerBook]     = useState(seed.type === 'per_booking' ? seed.value ?? 0 : 50)
  const [tiers, setTiers]         = useState(
    seed.type === 'tiered_pct' && Array.isArray(seed.tiers) && seed.tiers.length
      ? seed.tiers
      : [{ upto: 10000, pct: 10 }, { upto: null, pct: 15 }]
  )
  const [saving, setSaving]       = useState(false)

  function updateTier(i, patch) {
    setTiers(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }
  function addTier() {
    setTiers(prev => {
      // Insert before the "null cap" (final) tier if present.
      const finalIdx = prev.findIndex(t => t.upto == null)
      const newTier  = { upto: 25000, pct: 12 }
      if (finalIdx === -1) return [...prev, newTier]
      const copy = [...prev]
      copy.splice(finalIdx, 0, newTier)
      return copy
    })
  }
  function removeTier(i) {
    setTiers(prev => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    setSaving(true)
    let config
    if (type === 'flat_pct')    config = { type, value: Number(flatPct) || 0 }
    else if (type === 'per_booking') config = { type, value: Number(perBook) || 0 }
    else {
      // Sanitize tiers: strip empty rows, coerce numbers.
      const cleaned = tiers
        .map(t => ({
          upto: t.upto == null || t.upto === '' ? null : Number(t.upto),
          pct:  Number(t.pct) || 0,
        }))
        .filter(t => t.pct > 0 || t.upto != null)
      config = { type, tiers: cleaned }
    }
    await onSave(config)
    setSaving(false)
  }

  const BRAND = '#1B4FCC'
  const LIME  = '#7DC31E'

  return (
    <div className="border-t border-gray-100 bg-blue-50/30 px-4 py-4 space-y-3">
      {/* Type selector */}
      <div>
        <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">Commission Type</p>
        <div className="grid grid-cols-3 gap-1 bg-white rounded-xl p-1 border border-gray-200">
          {[
            { id: 'flat_pct',    label: 'Flat %'   },
            { id: 'per_booking', label: 'Per Book' },
            { id: 'tiered_pct',  label: 'Tiered'   },
          ].map(opt => {
            const active = type === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setType(opt.id)}
                className="py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={active
                  ? { backgroundColor: BRAND, color: 'white' }
                  : { color: '#4B5563' }}>
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Per-type inputs */}
      {type === 'flat_pct' && (
        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 block mb-1">Percent of Revenue</label>
          <div className="relative">
            <input
              type="number"
              min="0" max="100" step="0.5"
              value={flatPct}
              onChange={e => setFlatPct(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="absolute right-3 top-2.5 text-gray-400 text-sm">%</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Rep earns <span className="font-semibold" style={{ color: BRAND }}>{Number(flatPct) || 0}%</span> of every dollar booked.
          </p>
        </div>
      )}

      {type === 'per_booking' && (
        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 block mb-1">Dollars per Booking</label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0" step="1"
              value={perBook}
              onChange={e => setPerBook(e.target.value)}
              className="w-full border border-gray-200 rounded-xl pl-6 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Rep earns <span className="font-semibold" style={{ color: BRAND }}>${Number(perBook) || 0}</span> flat for each booked job.
          </p>
        </div>
      )}

      {type === 'tiered_pct' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase font-semibold tracking-wide text-gray-500">Revenue Tiers</label>
            <button
              onClick={addTier}
              className="flex items-center gap-1 text-xs font-semibold"
              style={{ color: BRAND }}>
              <Plus className="w-3 h-3" /> Add Tier
            </button>
          </div>
          <div className="space-y-2">
            {tiers.map((t, i) => {
              const isLast = t.upto == null
              return (
                <div key={i} className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                  <div className="flex-1 flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Up to</span>
                    {isLast ? (
                      <span className="font-semibold text-gray-700 flex-1">∞ (final tier)</span>
                    ) : (
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1.5 text-gray-400">$</span>
                        <input
                          type="number"
                          min="0" step="500"
                          value={t.upto ?? ''}
                          onChange={e => updateTier(i, { upto: e.target.value === '' ? null : Number(e.target.value) })}
                          className="w-full border border-gray-200 rounded-lg pl-5 pr-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                      </div>
                    )}
                    <span className="text-gray-500">at</span>
                    <div className="relative w-16">
                      <input
                        type="number"
                        min="0" max="100" step="0.5"
                        value={t.pct}
                        onChange={e => updateTier(i, { pct: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 pr-5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <span className="absolute right-1.5 top-1 text-gray-400 text-xs">%</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeTier(i)}
                    disabled={tiers.length <= 1}
                    className="p-1 rounded text-red-400 hover:bg-red-50 disabled:opacity-30">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Earnings are calculated band-by-band — the % for each tier only applies to revenue inside that band.
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-semibold">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ backgroundColor: LIME }}>
          {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Commission
        </button>
      </div>
    </div>
  )
}

/* ── Credentials Panel ──────────────────────────────────────────────────────
 * Shown immediately after a temp-password create. Renders the email +
 * temp password with copy buttons and, if a phone is on file, an
 * `sms:` deep-link that drafts a ready-to-send message in the
 * manager's default texting app.
 *
 * This is the ONLY moment the password is visible — once dismissed, it
 * isn't recoverable. The rep is forced to rotate it on first login
 * (force_password_change = true on their public.users row), so even
 * if someone shoulder-surfs the panel, the credential is single-use
 * in practice.
 */
function CredentialsPanel({ creds, onCopyToast, onDismiss }) {
  const BRAND = '#1B4FCC'

  function copy(value, label) {
    try {
      navigator.clipboard.writeText(value)
      onCopyToast(`${label} copied`)
    } catch {
      onCopyToast(`Couldn't copy — long-press to copy manually`, 'error')
    }
  }

  // Build the SMS body once so the "Text to rep" link and the
  // "Copy message" button stay in sync. Plain text, kept short
  // because some carriers truncate links inside long SMS bodies.
  //
  // Layout note: the temp password is the one token the rep actually
  // needs to copy out of the message. We put it on its own line with
  // no adjacent punctuation (the label sits on the previous line)
  // so a double-tap lands squarely on the password — no stray colon
  // or trailing parenthesis sneaking into the selection.
  const smsBody =
    `Hey ${(creds.fullName || '').split(' ')[0] || 'there'} — your KnockIQ login is ready.\n\n` +
    `Email: ${creds.email}\n\n` +
    `Temp password:\n${creds.password}\n\n` +
    `Sign in: ${creds.loginUrl}\n\n` +
    `(You'll be asked to set your own password on first sign-in.)`

  // sms: URI — the body must be percent-encoded. Phone is optional;
  // omitting it still drafts a blank-recipient SMS on iOS/Android.
  const smsHref = creds.phone
    ? `sms:${encodeURIComponent(creds.phone)}?body=${encodeURIComponent(smsBody)}`
    : `sms:?body=${encodeURIComponent(smsBody)}`

  return (
    <div className="bg-white rounded-2xl shadow-sm border-2 border-amber-300 mb-3 overflow-hidden">
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-amber-700" />
          <p className="text-sm font-semibold text-amber-900">
            One-time credentials for {creds.fullName}
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded-md text-amber-700 hover:bg-amber-100"
          title="Dismiss — credentials won't be shown again">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
          This password is shown once. The rep will be forced to set their own on first sign-in.
        </p>

        {/* Email row */}
        <div>
          <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1">Email</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-800 truncate">
              {creds.email}
            </code>
            <button
              onClick={() => copy(creds.email, 'Email')}
              className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              title="Copy email">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Password row */}
        <div>
          <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1">Temporary Password</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-800 truncate">
              {creds.password}
            </code>
            <button
              onClick={() => copy(creds.password, 'Password')}
              className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              title="Copy password">
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Phone row — only if we captured one */}
        {creds.phone && (
          <div>
            <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1">Phone on file</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-800 truncate flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-gray-400" />
                {creds.phone}
              </code>
            </div>
          </div>
        )}

        {/* Action buttons — Text-to-rep is the headline action when a
            phone exists; otherwise it falls back to a no-recipient
            draft so the manager can still use it as a clipboard. */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={() => copy(smsBody, 'Message')}
            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50">
            <Copy className="w-4 h-4" />
            Copy Message
          </button>
          <a
            href={smsHref}
            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-sm font-bold"
            style={{ backgroundColor: BRAND }}>
            <MessageSquare className="w-4 h-4" />
            {creds.phone ? 'Text Rep' : 'Open SMS'}
          </a>
        </div>

        <button
          onClick={onDismiss}
          className="w-full py-2 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-50">
          I've delivered the credentials — dismiss
        </button>
      </div>
    </div>
  )
}
