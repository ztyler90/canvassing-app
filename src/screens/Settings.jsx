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
import { Capacitor } from '@capacitor/core'
import { ChevronLeft, Zap, Check, ExternalLink, Lock, CheckCircle, XCircle, Loader, Users, UserPlus, Trash2, Building2, Shield, DollarSign, Plus, X, Target, Hash, Mail, Send, Phone, Key, Copy, MessageSquare, RefreshCw, Tag, Pencil, Link2, UserCheck, Clock, Share2, Workflow, HelpCircle, PauseCircle, AlertTriangle, Calendar, ShieldAlert, Sun, BarChart3 } from 'lucide-react'
import { getOrgWebhookConfig, saveOrgWebhookConfig, DEFAULT_WEBHOOK_EVENTS, fireZapierWebhook, getCurrentUser, getAllReps, createRep, deleteRep, resendRepInvite, getMyOrganization, updateRepCommissionConfig, updateOrganizationGoal, getOrgServices, createOrgService, updateOrgService, deleteOrgService, getMyInviteCode, regenerateInviteCode, setInviteCodeEnabled, getPendingReps, approveRep, rejectRep, buildInviteUrl, setOrgCommissionEnabled, setOrgRoofInsightsEnabled, setOrgShareLeaderboard, setOrgLeaderboardHideRevenue, pauseOrganization, cancelOrganization, deleteOrganization, signOut, createPortalSession, changePlan, syncSeats } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { describeCommission } from '../lib/repStats.js'
import { isProTier, isCommissionEnabled, isRoofInsightsEnabled, isLeaderboardShared, isLeaderboardRevenueHidden } from '../lib/tier.js'
import { ProBadge, ProUpgradeModal } from '../components/ProGate.jsx'
import CommissionEditor from '../components/CommissionEditor.jsx'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

export default function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshUser } = useAuth()
  const teamSectionRef = useRef(null)
  // Which account-lifecycle modal is open: null | 'pause' | 'cancel'.
  // (Hard delete lives inside the cancel modal's danger step.)
  const [lifecycleModal, setLifecycleModal] = useState(null)
  const [portalBusy, setPortalBusy] = useState(false)
  // Plan-switch confirmation modal: null, or { target:'pro'|'standard', kind }
  // where kind ∈ 'upgrade'|'downgrade'|'undo'|'trial-pro'|'trial-standard'.
  const [planModal, setPlanModal]   = useState(null)
  const [planBusy, setPlanBusy]     = useState(false)
  const [user, setUser]               = useState(null)
  const [org, setOrg]                 = useState(null)
  const [webhookUrl, setWebhookUrl]   = useState('')
  const [savedUrl, setSavedUrl]       = useState('')
  const [webhookEvents, setWebhookEvents] = useState(DEFAULT_WEBHOOK_EVENTS)
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
  // Onboarding mode. 'invite' (default) emails the rep a one-time
  // set-password link via Resend — the manager never handles a credential.
  // 'temp_password' is kept as a fallback (manager sets/generates a temp
  // password and delivers it out-of-band) for reps who don't reliably use
  // email, or if an invite email bounces. The edge function supports both.
  const [newRepMode, setNewRepMode] = useState('invite')
  const [newRepPassword, setNewRepPassword] = useState('')
  const [showTempPass, setShowTempPass] = useState(false)
  const [addingRep, setAddingRep]     = useState(false)
  const [deletingRepId, setDeletingRepId] = useState(null)
  const [resendingRepId, setResendingRepId] = useState(null)   // rep id currently being re-invited
  const [commissionRepId, setCommissionRepId] = useState(null) // rep whose commission is being edited
  const [savingCommissionToggle, setSavingCommissionToggle] = useState(false)
  const [savingRoofToggle, setSavingRoofToggle] = useState(false)
  const [savingLeaderboardToggle, setSavingLeaderboardToggle] = useState(false)
  const [savingHideRevenueToggle, setSavingHideRevenueToggle] = useState(false)
  const [showRoofUpsell, setShowRoofUpsell] = useState(false)
  // Credentials panel — shown after a successful temp-password create so
  // the manager can copy the password and/or fire off a pre-filled SMS.
  // { fullName, email, phone, password, loginUrl } | null
  const [pendingCreds, setPendingCreds] = useState(null)

  // Daily goal config — hydrated from org on load, edited in-place.
  const [goalType,     setGoalType]     = useState('revenue')  // 'revenue' | 'count'
  const [goalValue,    setGoalValue]    = useState('1000')
  const [countLabel,   setCountLabel]   = useState('estimates') // 'estimates' | 'appointments'
  // Optional manager-set monthly team goal. Empty string means "no
  // override — auto-derive from daily goal × team size × pace". When set,
  // GoalTrackerCard uses this number directly instead of multiplying
  // per-rep daily goal × period days (which over-counted for solo orgs
  // and teams that don't canvass every day).
  const [monthlyGoal,  setMonthlyGoal]  = useState('')
  // Manager-declared Close Rate target (percent). Empty string means "no
  // override — the Close Rate gauge falls back to 5.0%". Close rate is
  // measured as conversation → booked job (bookings ÷ conversations).
  const [closeRateGoal, setCloseRateGoal] = useState('')
  const [savingGoal,   setSavingGoal]   = useState(false)

  // Shareable invite link — owner generates one URL their reps can sign
  // up through, avoiding manual rep-by-rep account creation. State is
  // hydrated from the get_my_invite_code RPC on load. `code` may be null
  // briefly for orgs that existed before the 20260528 migration ran
  // (the migration backfills, but the UI defends against null anyway).
  const [inviteCode,     setInviteCode]     = useState(null)        // string | null
  const [inviteEnabled,  setInviteEnabled]  = useState(true)
  const [inviteToggling, setInviteToggling] = useState(false)
  const [inviteRotating, setInviteRotating] = useState(false)

  // Pending reps — populated for managers whose org received self-signups
  // via the invite link. The owner Approves (status → 'active') or
  // Rejects (status → 'rejected', org_id cleared) one at a time.
  const [pendingReps,    setPendingReps]    = useState([])
  const [pendingActionId, setPendingActionId] = useState(null)      // rep id mid-Approve/Reject

  // Services — manager-defined list of offerings (window cleaning, HVAC
  // tune-up, solar consult, etc.) that powers the rep's booking modal.
  // No defaults — new orgs start empty and must explicitly add services
  // so the chip list always reflects what the company actually sells.
  const [services,        setServices]        = useState([])
  const [newServiceLabel, setNewServiceLabel] = useState('')
  const [addingService,   setAddingService]   = useState(false)
  const [editingSvcId,    setEditingSvcId]    = useState(null)
  const [editingSvcLabel, setEditingSvcLabel] = useState('')
  const [savingSvcId,     setSavingSvcId]     = useState(null)
  const [deletingSvcId,   setDeletingSvcId]   = useState(null)

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
    // Fire everything in parallel — invite + pending live alongside the
    // other Settings fetches so the page renders in one paint.
    const [u, repList, myOrg, svcList, invite, pending] = await Promise.all([
      getCurrentUser(),
      getAllReps(),
      getMyOrganization(),
      getOrgServices(),
      getMyInviteCode(),
      getPendingReps(),
    ])
    setUser(u)
    setReps(repList)
    setOrg(myOrg)
    setServices(svcList)
    setPendingReps(pending || [])
    if (invite) {
      setInviteCode(invite.code || null)
      setInviteEnabled(Boolean(invite.enabled))
    }
    if (myOrg) {
      setGoalType(myOrg.daily_goal_type || 'revenue')
      setGoalValue(String(myOrg.daily_goal_value ?? 1000))
      setCountLabel(myOrg.count_goal_label || 'estimates')
      setMonthlyGoal(myOrg.monthly_goal_value != null ? String(myOrg.monthly_goal_value) : '')
      setCloseRateGoal(myOrg.close_rate_goal != null ? String(myOrg.close_rate_goal) : '')
    }
    const cfg = await getOrgWebhookConfig()
    if (cfg?.url) {
      setWebhookUrl(cfg.url)
      setSavedUrl(cfg.url)
    }
    if (cfg?.events) setWebhookEvents({ ...DEFAULT_WEBHOOK_EVENTS, ...cfg.events })
    setLoading(false)
  }

  // ── Invite-link + pending-approval handlers ─────────────────────────
  async function handleToggleInvite() {
    const next = !inviteEnabled
    setInviteToggling(true)
    // Optimistic flip — the network round-trip is short and the cost of
    // a flicker is more annoying than re-syncing on error.
    setInviteEnabled(next)
    const { error } = await setInviteCodeEnabled(next)
    setInviteToggling(false)
    if (error) {
      setInviteEnabled(!next)
      showToast('Could not update the invite link: ' + error.message, 'error')
    } else {
      showToast(next ? 'Invite link enabled' : 'Invite link disabled')
    }
  }

  async function handleRotateInvite() {
    if (!window.confirm(
      'Regenerate the invite code? Anyone with the old link will no longer be able to join.',
    )) return
    setInviteRotating(true)
    const { code, error } = await regenerateInviteCode()
    setInviteRotating(false)
    if (error) {
      showToast('Could not regenerate: ' + error.message, 'error')
      return
    }
    setInviteCode(code)
    showToast('New invite link generated')
  }

  async function handleCopyInviteUrl() {
    const url = buildInviteUrl(inviteCode)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      showToast('Invite link copied')
    } catch {
      showToast("Couldn't copy — long-press the link to copy it manually.", 'error')
    }
  }

  async function handleShareInvite() {
    const url = buildInviteUrl(inviteCode)
    if (!url) return
    const orgName = org?.name || 'our team'
    const message = `Join ${orgName} on KnockIQ — sign up here: ${url}`
    // Native share sheet on mobile (iOS/Android) when available; falls
    // back to a copy on desktop browsers that don't expose Web Share.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'KnockIQ team invite', text: message, url })
        return
      } catch (e) {
        // User cancelled the share sheet — not an error.
        if (e?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(message)
      showToast('Invite message copied')
    } catch {
      showToast("Couldn't open share — long-press the link instead.", 'error')
    }
  }

  async function handleApproveRep(rep) {
    setPendingActionId(rep.id)
    const { error } = await approveRep(rep.id)
    setPendingActionId(null)
    if (error) {
      showToast('Could not approve: ' + error.message, 'error')
      return
    }
    setPendingReps(prev => prev.filter(p => p.id !== rep.id))
    // Optimistically add to the rep list so the manager sees them
    // immediately under "Team" without a re-fetch.
    setReps(prev => prev.find(r => r.id === rep.id) ? prev : [
      ...prev,
      { id: rep.id, email: rep.email, full_name: rep.full_name, phone: rep.phone || null, role: 'rep' },
    ])
    showToast(`${rep.full_name || rep.email} approved`)
    // Approving adds a billable seat. Approve runs via RPC (not manage-team),
    // so nudge Stripe to update the subscription quantity. Fire-and-forget.
    syncSeats().catch(() => {})
  }

  async function handleRejectRep(rep) {
    if (!window.confirm(`Reject ${rep.full_name || rep.email}'s sign-up request?`)) return
    setPendingActionId(rep.id)
    const { error } = await rejectRep(rep.id)
    setPendingActionId(null)
    if (error) {
      showToast('Could not reject: ' + error.message, 'error')
      return
    }
    setPendingReps(prev => prev.filter(p => p.id !== rep.id))
    showToast(`${rep.full_name || rep.email} rejected`)
  }

  // ── Services CRUD handlers ────────────────────────────────────────────
  async function handleAddService(e) {
    if (e) e.preventDefault()
    const label = newServiceLabel.trim()
    if (!label) return
    // Client-side duplicate guard before round-tripping. The DB unique
    // index is case-insensitive, so we match the same way here to give
    // an instant inline message instead of waiting for the 23505 round-trip.
    if (services.some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      showToast(`"${label}" is already in your services list`, 'error')
      return
    }
    setAddingService(true)
    const { data, error } = await createOrgService(label)
    setAddingService(false)
    if (error) {
      // Postgres unique-violation = race lost to another tab/manager.
      const msg = error.code === '23505'
        ? `"${label}" is already in your services list`
        : `Couldn't add service: ${error.message || 'unknown error'}`
      showToast(msg, 'error')
      return
    }
    setServices((prev) => [...prev, data])
    setNewServiceLabel('')
    showToast(`Added "${data.label}"`)
  }

  function beginEditService(svc) {
    setEditingSvcId(svc.id)
    setEditingSvcLabel(svc.label)
  }

  function cancelEditService() {
    setEditingSvcId(null)
    setEditingSvcLabel('')
  }

  async function handleSaveServiceEdit(svc) {
    const label = editingSvcLabel.trim()
    if (!label) { showToast('Service name is required', 'error'); return }
    if (label === svc.label) { cancelEditService(); return }
    if (services.some((s) => s.id !== svc.id && s.label.toLowerCase() === label.toLowerCase())) {
      showToast(`"${label}" is already in your services list`, 'error')
      return
    }
    setSavingSvcId(svc.id)
    const { data, error } = await updateOrgService(svc.id, { label })
    setSavingSvcId(null)
    if (error) {
      const msg = error.code === '23505'
        ? `"${label}" is already in your services list`
        : `Couldn't save: ${error.message || 'unknown error'}`
      showToast(msg, 'error')
      return
    }
    setServices((prev) => prev.map((s) => (s.id === svc.id ? data : s)))
    cancelEditService()
    showToast('Service updated')
  }

  async function handleDeleteService(svc) {
    if (!window.confirm(`Remove "${svc.label}" from your services list?\n\nReps will no longer be able to select it on new bookings. Past bookings keep their service name.`)) return
    setDeletingSvcId(svc.id)
    const { error } = await deleteOrgService(svc.id)
    setDeletingSvcId(null)
    if (error) {
      showToast(`Couldn't delete: ${error.message || 'unknown error'}`, 'error')
      return
    }
    setServices((prev) => prev.filter((s) => s.id !== svc.id))
    showToast(`Removed "${svc.label}"`)
  }

  async function handleSaveGoal() {
    if (!org?.id) return
    const num = Number(goalValue)
    if (!Number.isFinite(num) || num < 0) {
      showToast('Enter a valid non-negative number', 'error'); return
    }
    // Empty string → null (clear the override). Anything else must parse
    // as a non-negative number — same rules as the daily goal.
    let monthlyPatch
    if (monthlyGoal === '' || monthlyGoal == null) {
      monthlyPatch = null
    } else {
      const m = Number(monthlyGoal)
      if (!Number.isFinite(m) || m < 0) {
        showToast('Enter a valid monthly goal, or leave it blank to auto-calculate', 'error'); return
      }
      monthlyPatch = m
    }
    // Close Rate goal: empty → null (use the 5% default). Otherwise must parse
    // as a percentage in the 0–100 range.
    let closeRatePatch
    if (closeRateGoal === '' || closeRateGoal == null) {
      closeRatePatch = null
    } else {
      const c = Number(closeRateGoal)
      if (!Number.isFinite(c) || c <= 0 || c > 100) {
        showToast('Enter a close rate goal between 0 and 100, or leave it blank for the default', 'error'); return
      }
      closeRatePatch = c
    }
    setSavingGoal(true)
    const { data, error } = await updateOrganizationGoal(org.id, {
      type:          goalType,
      value:         num,
      countLabel:    countLabel,
      monthlyGoal:   monthlyPatch,
      closeRateGoal: closeRatePatch,
    })
    setSavingGoal(false)
    if (error) {
      showToast('Could not save goal: ' + error.message, 'error')
    } else {
      setOrg(data)
      showToast('Goals updated')
    }
  }

  async function handleAddRep() {
    const name  = newRepName.trim()
    const mail  = newRepEmail.trim()
    const phone = newRepPhone.trim()
    const pass  = newRepPassword
    const isInvite = newRepMode === 'invite'
    if (!name || !mail) {
      showToast('Name and email are required.', 'error'); return
    }
    if (!isInvite && (!pass || pass.length < 8)) {
      showToast('Temporary password must be at least 8 characters.', 'error'); return
    }
    setAddingRep(true)
    const { user: created, loginUrl, emailSent, emailError, error } = await createRep({
      fullName: name,
      email:    mail,
      phone:    phone || null,
      mode:     isInvite ? 'invite' : 'temp_password',
      password: isInvite ? undefined : pass,
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

    // Reset the form. For temp-password we keep the section context until
    // the manager dismisses the creds panel; for invite we just close it.
    setNewRepName(''); setNewRepEmail(''); setNewRepPhone(''); setNewRepPassword('')
    setShowTempPass(false)

    if (isInvite) {
      setShowAddRep(false)
      if (emailSent) {
        showToast(`Invite sent to ${created.email}.`)
      } else {
        // Rep exists but the email didn't go out (unverified domain, bad
        // address, etc.). Don't leave the manager stranded — point them at
        // the per-rep Resend button and the Temp Password fallback.
        showToast(
          `${created.full_name} was added, but the invite email failed` +
          (emailError ? ` (${emailError})` : '') +
          `. Use the ✈ Resend button on their row, or re-add them with Temp Password.`,
          'error',
        )
      }
      return
    }

    // Temp-password path — surface credentials so the manager can copy/SMS
    // them. The password is plaintext here by design — it's the only moment
    // we can show it. Once the rep logs in, force_password_change rotates
    // them to their own.
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

  async function handleManageBilling() {
    setPortalBusy(true)
    const { url, error } = await createPortalSession()
    if (error || !url) {
      setPortalBusy(false)
      showToast(error?.message || 'Could not open the billing portal.', 'error')
      return
    }
    if (Capacitor.isNativePlatform()) {
      // App Store Guideline 3.1.1: payment-related screens must open in the
      // system browser, not the in-app WebView. Capacitor routes _blank URLs
      // to Safari on iOS.
      window.open(url, '_blank', 'noopener,noreferrer')
      setPortalBusy(false)
    } else {
      window.location.href = url
    }
  }

  // Open the plan-switch confirmation. `kind` decides the copy + what the
  // server will do; see the change-plan edge function for the billing rules.
  //
  // On native iOS, Apple App Store Guideline 3.1.1 disallows in-app payment
  // flows that don't use In-App Purchase. Apple's 2024 US-storefront ruling
  // does permit external-browser link-out for payment. So on native we skip
  // the in-app modal and open the equivalent screen on the web app in the
  // user's default browser — the user completes the change there, and the
  // org row reconciles on next launch / refresh.
  function openPlanModal(target) {
    if (Capacitor.isNativePlatform()) {
      // _blank on Capacitor iOS is routed to the system browser (Safari).
      const url = `https://getknockiq.com/settings?openPlan=${encodeURIComponent(target)}`
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    const inTrialNow = org?.status === 'trial' || org?.status === 'trialing'
    let kind
    if (inTrialNow)            kind = target === 'pro' ? 'trial-pro' : 'trial-standard'
    else if (target === 'pro') kind = isPro ? 'undo' : 'upgrade'   // isPro+target pro = cancel a pending downgrade
    else                       kind = 'downgrade'
    setPlanModal({ target, kind })
  }

  async function confirmPlanChange() {
    if (!planModal) return
    setPlanBusy(true)
    const { data, error } = await changePlan(planModal.target)
    if (error) {
      setPlanBusy(false)
      setPlanModal(null)
      showToast(error.message || 'Could not change your plan. Please try again.', 'error')
      return
    }
    // Re-pull the org row (tier/selected_plan may have changed) and re-sync the
    // auth profile so tier gating across the app reflects the new plan.
    try {
      const fresh = await getMyOrganization()
      if (fresh) setOrg(fresh)
      await refreshUser?.()
    } catch { /* non-fatal — webhook will reconcile */ }
    setPlanBusy(false)
    setPlanModal(null)

    const applied = data?.applied
    if (applied === 'upgrade_immediate')        showToast('Upgraded to Pro — features unlocked.')
    else if (applied === 'downgrade_scheduled') {
      const when = data?.effective_at
        ? new Date(data.effective_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : 'your next renewal'
      showToast(`Switching to Standard on ${when}. You keep Pro until then.`)
    }
    else if (applied === 'downgrade_cancelled') showToast('Kept on Pro — the switch to Standard was cancelled.')
    else if (applied === 'trial')               showToast(`Post-trial plan set to ${planModal.target === 'pro' ? 'Pro' : 'Standard'}.`)
    else                                        showToast('Plan updated.')
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
    if (!org?.id) { showToast('No organization loaded', 'error'); return }
    setSaving(true)
    const { error } = await saveOrgWebhookConfig(org.id, { url: webhookUrl.trim() || null })
    setSaving(false)
    if (error) {
      showToast('Failed to save: ' + error.message, 'error')
    } else {
      setSavedUrl(webhookUrl.trim())
      showToast('Webhook URL saved!')
    }
  }

  // Toggle a single event on/off and persist immediately (org-level).
  async function handleToggleEvent(key) {
    if (!org?.id) { showToast('No organization loaded', 'error'); return }
    const next = { ...webhookEvents, [key]: !webhookEvents[key] }
    setWebhookEvents(next) // optimistic
    const { error } = await saveOrgWebhookConfig(org.id, { events: next })
    if (error) {
      setWebhookEvents(webhookEvents) // revert
      showToast('Could not update events: ' + error.message, 'error')
    }
  }

  async function handleTestWebhook() {
    if (!savedUrl) { showToast('Save your webhook URL first', 'error'); return }
    setTesting(true)
    setTestResult(null)
    // Mirror the real `session_ended` payload (same keys) so Zapier's field
    // mapper learns every field during setup — populated with sample values.
    const now = new Date()
    const started = new Date(now.getTime() - 3 * 3600000) // 3h earlier
    const payload = {
      event: 'test',
      source: 'knockiq',
      message: 'KnockIQ webhook test — connection successful! (sample data)',
      rep_name:       'Sample Rep',
      rep_email:      'rep@example.com',
      session_id:     'sample-session-0001',
      started_at:     started.toISOString(),
      ended_at:       now.toISOString(),
      doors_knocked:  42,
      conversations:  18,
      estimates:      7,
      bookings:       3,
      revenue_booked: 5400.00,
      timestamp:      now.toISOString(),
    }
    const ok = await fireZapierWebhook(savedUrl, payload)
    setTesting(false)
    setTestResult(ok ? 'success' : 'error')
    setTimeout(() => setTestResult(null), 4000)
  }

  // Phase 1: tier comes from the organization row (source of truth).
  // Fallback to legacy user.plan during rollout.
  const isPro       = isProTier(org, user)
  const seatPrice   = isPro ? 50 : 25
  // Reverse-trial awareness: during the trial every org runs on full Pro, but
  // converts to the plan they picked at signup (selected_plan) when it ends.
  // Surfacing this prevents the "why am I on Pro when I chose Standard?"
  // confusion — and the "where did my Pro features go?" surprise at conversion.
  const inTrial        = org?.status === 'trial'
  const postTrialPlan  = org?.selected_plan === 'pro' ? 'pro' : 'standard'
  const postTrialPrice = postTrialPlan === 'pro' ? 50 : 25
  const trialEndsLabel = org?.trial_ends_at
    ? new Date(org.trial_ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  // Will the org lose features at conversion? (on Pro trial, reverting to Standard)
  const willDowngrade  = inTrial && postTrialPlan === 'standard'
  // Flat off-season pause "keep-warm" fee (dollars). Defaults to $15.
  const keepWarm    = org?.pause_fee_cents != null ? (org.pause_fee_cents / 100) : 15
  // Commission tracking is part of Standard — a manager opt-in toggle.
  const commissionOn = isCommissionEnabled(org, user)

  async function handleToggleCommission() {
    if (!org?.id) return
    setSavingCommissionToggle(true)
    const next = !org.commission_enabled
    const { data, error } = await setOrgCommissionEnabled(org.id, next)
    setSavingCommissionToggle(false)
    if (error) { showToast('Could not update commission add-on: ' + error.message, 'error'); return }
    setOrg(data || { ...org, commission_enabled: next })
    if (next) setCommissionRepId(null)
    showToast(next ? 'Commission tracking enabled' : 'Commission tracking turned off')
  }

  // Share the team leaderboard with reps (manager opt-in, off by default).
  const leaderboardOn = isLeaderboardShared(org)

  async function handleToggleLeaderboard() {
    if (!org?.id) return
    setSavingLeaderboardToggle(true)
    const next = !org.share_leaderboard
    const { data, error } = await setOrgShareLeaderboard(org.id, next)
    setSavingLeaderboardToggle(false)
    if (error) { showToast('Could not update leaderboard sharing: ' + error.message, 'error'); return }
    setOrg(data || { ...org, share_leaderboard: next })
    showToast(next ? 'Team leaderboard shared with reps' : 'Team leaderboard hidden from reps')
  }

  const hideRevenueOn = isLeaderboardRevenueHidden(org)

  async function handleToggleHideRevenue() {
    if (!org?.id) return
    setSavingHideRevenueToggle(true)
    const next = !org.leaderboard_hide_revenue
    const { data, error } = await setOrgLeaderboardHideRevenue(org.id, next)
    setSavingHideRevenueToggle(false)
    if (error) { showToast('Could not update revenue visibility: ' + error.message, 'error'); return }
    setOrg(data || { ...org, leaderboard_hide_revenue: next })
    showToast(next ? 'Revenue hidden from rep leaderboard' : 'Revenue shown on rep leaderboard')
  }

  // Roof Insights (Google Solar) is a Pro-only, opt-in add-on.
  const roofOn = isRoofInsightsEnabled(org, user)

  async function handleToggleRoofInsights() {
    if (!isPro) { setShowRoofUpsell(true); return }
    if (!org?.id) return
    setSavingRoofToggle(true)
    const next = !org.roof_insights_enabled
    const { data, error } = await setOrgRoofInsightsEnabled(org.id, next)
    setSavingRoofToggle(false)
    if (error) { showToast('Could not update Roof Insights add-on: ' + error.message, 'error'); return }
    setOrg(data || { ...org, roof_insights_enabled: next })
    showToast(next ? 'Roof Insights enabled' : 'Roof Insights turned off')
  }
  const monthlyCost = (reps.length + 1) * seatPrice  // +1 for the owner
  const roleLabel   = user?.is_super_admin ? 'Super-Admin' : (user?.role === 'manager' ? 'Owner' : 'Rep')
  // Only the org owner sees the pause/cancel/delete controls. Matches the
  // owner-only enforcement in the manage-team edge function, so a non-owner
  // manager never sees a button that would 403.
  const isOwner = user?.role === 'manager' && !!org?.owner_user_id && org.owner_user_id === user?.id

  // Self-serve plan switching is owner-only. Declared AFTER isOwner — it reads
  // isOwner, so it must not run before isOwner initializes.
  //   hasSubscription : the org has a real paid Stripe subscription. When true,
  //     switching drives Stripe (proration / period-end). When false (most orgs
  //     today — billing isn't enforced yet), change-plan does a no-charge,
  //     immediate tier flip in the DB. Either way the owner can switch.
  //   pendingDowngrade : a downgrade scheduled for the next renewal — only
  //     meaningful WITH a subscription. Without one, selected_plan='standard'
  //     on a Pro org is just the default and must NOT read as "pending".
  const hasSubscription  = !!org?.stripe_subscription_id
  const canSwitchPlans   = isOwner
  const pendingDowngrade = isOwner && hasSubscription && !inTrial && isPro && org?.selected_plan === 'standard'
  // On native iOS, plan changes link out to the browser (Apple Guideline 3.1.1)
  // instead of running the in-app Stripe flow — labels reflect that so reviewers
  // see this clearly as external-purchase link-out, not in-app payment.
  const planSwitchIsExternal = Capacitor.isNativePlatform()

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <ProUpgradeModal
        open={showRoofUpsell}
        onClose={() => setShowRoofUpsell(false)}
        feature="Roof Insights"
        blurb="See each home's roof size, complexity, pitch and sun exposure before you quote — straight from satellite data. Upgrade to Pro to switch it on."
        perks={['Roof square footage to size every estimate', 'Roofline complexity & pitch for accurate pricing', 'Steep-roof safety flags before the crew arrives']}
      />
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm font-medium shadow-lg ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-12 pb-5 bg-brand-header">
        <div className="flex items-center gap-3">
          {/* Always exit to the manager dashboard. `navigate(-1)` looks
              correct at a glance but creates a bounce loop: visiting a
              nested settings page (e.g. /settings/pipeline) then coming
              back to /settings leaves /settings/pipeline as the previous
              history entry, so pressing back here would push the user
              right back into the page they just left. Settings is only
              ever entered from /manager, so jumping there directly is the
              safe exit. */}
          <button onClick={() => navigate('/manager')} className="p-2 rounded-full bg-white/20">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <p className="text-blue-200 text-xs">KnockIQ</p>
            <h1 className="text-white font-bold text-lg">Settings & Billing</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-6 pb-10 max-w-lg mx-auto w-full">

        {/* Section order rationale: the owner's daily flow lives at the
            top of the page — invite link, team, daily goal, services,
            then the org snapshot. Plans + CRM Integration sit BELOW
            Organization because they're rarely touched after initial
            setup; surfacing them above the day-to-day controls created
            unnecessary scrolling past pricing every time someone wanted
            to tweak a service or check on pending reps. */}

        {/* ── Team Invite Link ────────────────────────────────────────
            Lets the owner share ONE URL that any number of reps can
            self-onboard through. Designed for companies with too many
            reps to add one-by-one in the form below. Sign-ups land in
            the Pending Approvals queue right under this card. */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              <h2 className="text-gray-700 font-semibold text-base">Team Invite Link</h2>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs font-medium text-gray-500">
                {inviteEnabled ? 'Active' : 'Disabled'}
              </span>
              <span
                onClick={inviteToggling ? undefined : handleToggleInvite}
                className={`relative inline-block w-9 h-5 rounded-full transition-colors ${inviteEnabled ? '' : 'bg-gray-300'} ${inviteToggling ? 'opacity-60' : ''}`}
                style={inviteEnabled ? { backgroundColor: BRAND_BLUE } : {}}
                role="switch"
                aria-checked={inviteEnabled}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                  style={{ transform: inviteEnabled ? 'translateX(16px)' : 'translateX(0)' }}
                />
              </span>
            </label>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-3">
            <p className="text-xs text-gray-500 leading-relaxed">
              Share this link so reps can sign up themselves. Each new sign-up shows
              up below under <span className="font-semibold text-gray-700">Pending Approvals</span>{' '}
              for you to confirm before they can canvass.
            </p>

            {/* URL row */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1">
                Sign-up URL
              </p>
              <div className="flex items-center gap-2">
                <code
                  className={`flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-gray-800 truncate ${!inviteEnabled ? 'opacity-50' : ''}`}
                  title={buildInviteUrl(inviteCode)}
                >
                  {inviteCode ? buildInviteUrl(inviteCode) : 'No invite code yet'}
                </code>
                <button
                  onClick={handleCopyInviteUrl}
                  disabled={!inviteCode || !inviteEnabled}
                  className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  title="Copy URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Code row — easier to read aloud over the phone than the URL */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1">
                Or share the code
              </p>
              <div className="flex items-center gap-2">
                <code
                  className={`flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-base font-mono tracking-widest text-gray-800 text-center ${!inviteEnabled ? 'opacity-50' : ''}`}
                >
                  {inviteCode || '—'}
                </code>
              </div>
            </div>

            {/* Actions — Share is primary so it gets the brand color. */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={handleRotateInvite}
                disabled={inviteRotating}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                title="Generate a new code — old link stops working"
              >
                {inviteRotating ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Regenerate
              </button>
              <button
                onClick={handleShareInvite}
                disabled={!inviteCode || !inviteEnabled}
                className="btn-brand flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
              >
                <Share2 className="w-4 h-4" />
                Share Link
              </button>
            </div>

            {!inviteEnabled && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                The link is disabled — anyone who taps it sees an "invite isn't active" page.
              </p>
            )}
          </div>

          {/* Pending Approvals — only renders when there's something to do.
              Sits inside the invite-link section because it's the direct
              consequence of having an active link. */}
          {pendingReps.length > 0 && (
            <div className="mt-4 bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-700" />
                <p className="text-sm font-semibold text-amber-900">
                  Pending Approvals
                </p>
                <span className="text-[11px] font-bold text-white bg-amber-600 px-1.5 py-0.5 rounded-full">
                  {pendingReps.length}
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingReps.map((p) => (
                  <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                      style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}
                    >
                      {(p.full_name || p.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {p.full_name || '—'}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{p.email}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRejectRep(p)}
                        disabled={pendingActionId === p.id}
                        title="Reject sign-up"
                        className="p-2 rounded-xl text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors"
                      >
                        {pendingActionId === p.id
                          ? <Loader className="w-4 h-4 animate-spin" />
                          : <XCircle className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleApproveRep(p)}
                        disabled={pendingActionId === p.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-white text-xs font-bold disabled:opacity-40"
                        style={{ backgroundColor: BRAND_BLUE }}
                      >
                        {pendingActionId === p.id
                          ? <Loader className="w-3.5 h-3.5 animate-spin" />
                          : <UserCheck className="w-3.5 h-3.5" />}
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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

              {/* Discovery hint — surfaces the invite-link option for teams
                  that would rather not type every rep by hand. Shown inside
                  the manual form (only when it's open) so it can't be missed
                  the moment a manager starts the per-rep workflow. */}
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
                <Link2 className="w-4 h-4 text-blue-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  Onboarding a lot of reps? Share the{' '}
                  <button
                    type="button"
                    onClick={() => {
                      // Scroll the invite-link card into view — it's the
                      // section right above the Team header.
                      teamSectionRef.current?.previousElementSibling?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
                    }}
                    className="underline font-semibold"
                  >
                    invite link
                  </button>{' '}
                  above so they can sign up themselves. You'll approve each one before they can canvass.
                </p>
              </div>

              {/* Onboarding method toggle. Email Invite (default) sends the
                  rep a one-time set-password link; Temp Password lets the
                  manager set a credential to deliver out-of-band. */}
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Onboarding method</label>
                <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1">
                  {[
                    { id: 'invite',        label: 'Email Invite' },
                    { id: 'temp_password', label: 'Temp Password' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setNewRepMode(m.id)}
                      className={`py-2 rounded-lg text-xs font-bold transition-colors ${
                        newRepMode === m.id
                          ? 'bg-white shadow-sm text-gray-900'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

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
                  {newRepMode === 'invite'
                    ? 'Stored on the rep’s profile — handy for follow-up texts later.'
                    : 'Add a phone so you can text the credentials straight from the confirmation panel.'}
                </p>
              </div>

              {/* Temp password — only in temp-password mode. "Generate" fills
                  a readable two-word password; show/hide toggles visibility. */}
              {newRepMode === 'temp_password' && (
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
              )}

              {/* Explainer — what happens after the manager clicks the CTA,
                  tailored to the selected onboarding method. */}
              {newRepMode === 'invite' ? (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
                  <Mail className="w-4 h-4 text-blue-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-blue-800 leading-relaxed">
                    We'll email {newRepName.trim() || 'the rep'} a one-time link to set their own password and log in.
                    The link expires in 24 hours — they can be re-invited any time from their row below.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <Key className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    We'll show the password once so you can text it to {newRepName.trim() || 'the rep'}.
                    They'll be prompted to pick their own on first login — nothing is stored in plaintext afterwards.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowAddRep(false)
                    setNewRepName(''); setNewRepEmail(''); setNewRepPhone('')
                    setNewRepPassword(''); setShowTempPass(false); setNewRepMode('invite')
                  }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium">
                  Cancel
                </button>
                <button
                  onClick={handleAddRep}
                  disabled={addingRep}
                  className="btn-brand flex-1 py-2.5 rounded-xl text-sm font-bold">
                  {addingRep
                    ? (newRepMode === 'invite' ? 'Sending invite…' : 'Creating rep…')
                    : (newRepMode === 'invite' ? 'Send Invite'      : 'Create & Show Credentials')}
                </button>
              </div>
            </div>
          )}

          {/* ── Commission tracking (Standard) ────────────────────────── */}
          <div className="rounded-2xl p-4 shadow-sm border border-gray-100 bg-white mb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: '#ECFDF5' }}>
                  <DollarSign className="w-4 h-4" style={{ color: '#059669' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-800 text-sm">Commission tracking</p>
                    {commissionOn && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: '#ECFDF5', color: '#059669' }}>On</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Reps see their commission on their dashboard. Set each rep's rate below.
                  </p>
                </div>
              </div>

              <button
                onClick={handleToggleCommission}
                disabled={savingCommissionToggle}
                role="switch"
                aria-checked={!!org?.commission_enabled}
                className="relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50"
                style={{ backgroundColor: org?.commission_enabled ? '#059669' : '#D1D5DB' }}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${org?.commission_enabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          </div>

          {/* ── Share team leaderboard with reps ──────────────────────── */}
          <div className="rounded-2xl p-4 shadow-sm border border-gray-100 bg-white mb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: '#EFF6FF' }}>
                  <BarChart3 className="w-4 h-4" style={{ color: BRAND_BLUE }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-800 text-sm">Share team leaderboard</p>
                    {leaderboardOn && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: '#EFF6FF', color: BRAND_BLUE }}>On</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Lets reps see where they rank on the team — a bar-chart of everyone's
                    doors, conversations, estimates, bookings, and revenue on their
                    dashboard. Off keeps standings manager-only.
                  </p>
                </div>
              </div>

              <button
                onClick={handleToggleLeaderboard}
                disabled={savingLeaderboardToggle}
                role="switch"
                aria-checked={!!org?.share_leaderboard}
                className="relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50"
                style={{ backgroundColor: org?.share_leaderboard ? BRAND_BLUE : '#D1D5DB' }}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${org?.share_leaderboard ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            {/* Sub-option: hide revenue from the shared leaderboard. Only
                relevant once sharing is on. */}
            {leaderboardOn && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-3 pl-12">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">Hide revenue ($) from reps</p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Reps still see doors, conversations, {countLabel || 'estimates'}, and bookings — but not
                    each other's booked dollars.
                  </p>
                </div>
                <button
                  onClick={handleToggleHideRevenue}
                  disabled={savingHideRevenueToggle}
                  role="switch"
                  aria-checked={!!org?.leaderboard_hide_revenue}
                  className="relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50"
                  style={{ backgroundColor: org?.leaderboard_hide_revenue ? BRAND_BLUE : '#D1D5DB' }}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${org?.leaderboard_hide_revenue ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            )}
          </div>

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
                        {commissionOn && (
                          <p className="text-[11px] font-medium mt-0.5" style={{ color: rep.commission_config ? BRAND_BLUE : '#9CA3AF' }}>
                            <DollarSign className="inline w-3 h-3 -mt-0.5" />
                            {rep.commission_config ? describeCommission(rep.commission_config) : 'No commission set'}
                          </p>
                        )}
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
                      {commissionOn && (
                        <button
                          onClick={() => setCommissionRepId(isEditing ? null : rep.id)}
                          className="p-2 rounded-xl text-xs font-semibold"
                          style={{ color: isEditing ? '#9CA3AF' : BRAND_BLUE, backgroundColor: isEditing ? '#F3F4F6' : '#EFF6FF' }}>
                          {isEditing ? <X className="w-4 h-4" /> : 'Commission'}
                        </button>
                      )}
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
                  {isEditing && commissionOn && (
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

        {/* ── Pipeline ───────────────────────────────────────────────── */}
        {/* Entry tile to the Pipeline configuration screen (sales cycle,
            lead routing, follow-up SLA, stale window). Kept as a single
            tile here so the main Settings page stays scannable; the
            sub-screen owns the detailed pickers. */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Workflow className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-gray-700 font-semibold text-base">Pipeline</h2>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings/pipeline')}
            className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-blue-300 active:bg-gray-50 transition-colors text-left flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                Configure sales cycle &amp; lead routing
              </p>
              <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
                Pick your stages (appointment-based vs quick-quote), decide how leads
                route from setters to closers, and tune Hot Lead aging.
              </p>
            </div>
            <ExternalLink className="w-4 h-4 text-gray-400 shrink-0" />
          </button>
        </section>

        {/* ── Closers ────────────────────────────────────────────────── */}
        {/* Closers are managed separately from reps because their UX is
            different (no canvassing app, notification-first), and we
            don't want to clutter the Team section with role-aware tabs.
            The sub-screen handles invite + list + notification prefs. */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <UserCheck className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-gray-700 font-semibold text-base">Closers</h2>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings/closers')}
            className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-blue-300 active:bg-gray-50 transition-colors text-left flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                Manage closers &amp; notification routing
              </p>
              <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
                Invite the people who receive setter-booked appointments. Set their
                preferred channel (app, email, SMS). High-ticket sales only.
              </p>
            </div>
            <ExternalLink className="w-4 h-4 text-gray-400 shrink-0" />
          </button>
        </section>

        {/* ── Managers (owner-only) ──────────────────────────────────── */}
        {/* Only the account owner can add other managers or route pipeline
            emails to them — adding a teammate who sees the whole dashboard
            (and consumes a seat) is an owner-level decision. */}
        {isOwner && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              <h2 className="text-gray-700 font-semibold text-base">Managers</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings/managers')}
              className="w-full bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:border-blue-300 active:bg-gray-50 transition-colors text-left flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  Add managers &amp; pipeline email alerts
                </p>
                <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
                  Give other managers a dashboard seat to review team performance, or add
                  email-only managers who just get alerts on hot leads, appointments &amp;
                  estimates, or booked jobs.
                </p>
              </div>
              <ExternalLink className="w-4 h-4 text-gray-400 shrink-0" />
            </button>
          </section>
        )}

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

            {/* Monthly team goal — optional override for the Overview's Goal
                Tracker. Without this set, the tracker auto-derives the
                period goal from daily goal × number of days, which doesn't
                account for team size or how many days the team actually
                canvasses. Manager-entered numbers always win. */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">
                Monthly Team Goal <span className="text-gray-400 normal-case font-medium">(optional)</span>
              </p>
              <div className="flex items-center gap-2">
                {goalType === 'revenue' && (
                  <span className="text-gray-500 text-sm font-semibold">$</span>
                )}
                <input
                  type="number"
                  min="0"
                  step={goalType === 'revenue' ? '500' : '10'}
                  value={monthlyGoal}
                  onChange={(e) => setMonthlyGoal(e.target.value)}
                  className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold focus:border-blue-400 focus:outline-none"
                  placeholder={goalType === 'revenue' ? 'e.g. 50000' : 'e.g. 200'}
                />
                <span className="text-gray-500 text-sm font-medium whitespace-nowrap">
                  {goalType === 'revenue'
                    ? 'per month'
                    : `${countLabel === 'appointments' ? 'appts' : 'ests'}/mo`}
                </span>
              </div>
              <p className="text-gray-400 text-[11px] mt-1.5">
                Drives the Overview's Goal Tracker. Leave blank to auto-calculate
                from your daily target. Setting it directly is the better
                fit when team size or working cadence varies.
              </p>
            </div>

            {/* Close Rate goal — target for the Overview's Close Rate gauge.
                Close rate here means conversation → booked job (bookings ÷
                conversations), so the goal is the % of conversations the team
                aims to turn into booked jobs. Blank falls back to 5%. */}
            <div>
              <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-1.5">
                Close Rate Goal <span className="text-gray-400 normal-case font-medium">(optional)</span>
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={closeRateGoal}
                  onChange={(e) => setCloseRateGoal(e.target.value)}
                  className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm font-semibold focus:border-blue-400 focus:outline-none"
                  placeholder="e.g. 5"
                />
                <span className="text-gray-500 text-sm font-medium whitespace-nowrap">% target</span>
              </div>
              <p className="text-gray-400 text-[11px] mt-1.5">
                Sets the target on the Overview's Close Rate gauge. Close rate is
                measured as <span className="font-semibold text-gray-500">conversation → booked job</span>{' '}
                (booked jobs ÷ conversations) — not per door knocked. Leave blank
                to use the default 5%.
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

        {/* ── Services ───────────────────────────────────────────────── */}
        {/* Manager-defined list of offerings (window cleaning, HVAC tune-up,
            solar consult, etc.) that powers the chip selector in the rep's
            booking modal. Empty by default — reps see an empty-state nudge
            until the manager adds at least one service here, so the list
            always reflects what THIS company actually sells. */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-gray-700 font-semibold text-base">Services</h2>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 space-y-4">
            <p className="text-gray-500 text-xs">
              These are the services your reps can select when booking a job.
              Add the offerings your company sells — anything from "Window Cleaning"
              to "HVAC Tune-Up" to "Solar Consultation".
            </p>

            {/* Existing services list */}
            {services.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                <p className="text-gray-600 text-sm font-medium">No services yet</p>
                <p className="text-gray-400 text-xs mt-1">
                  Reps won't see any service chips on the booking screen until you add at least one below.
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {services.map((svc) => {
                  const isEditing = editingSvcId === svc.id
                  const isSaving  = savingSvcId === svc.id
                  const isDeleting = deletingSvcId === svc.id
                  return (
                    <li key={svc.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-100 bg-gray-50">
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={editingSvcLabel}
                            autoFocus
                            onChange={(e) => setEditingSvcLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')  { e.preventDefault(); handleSaveServiceEdit(svc) }
                              if (e.key === 'Escape') { e.preventDefault(); cancelEditService() }
                            }}
                            disabled={isSaving}
                            className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                          />
                          <button
                            onClick={() => handleSaveServiceEdit(svc)}
                            disabled={isSaving}
                            className="p-1.5 rounded-lg text-white disabled:opacity-50"
                            style={{ backgroundColor: BRAND_BLUE }}
                            title="Save">
                            {isSaving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={cancelEditService}
                            disabled={isSaving}
                            className="p-1.5 rounded-lg bg-gray-200 text-gray-600 disabled:opacity-50"
                            title="Cancel">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-sm text-gray-800">{svc.label}</span>
                          <button
                            onClick={() => beginEditService(svc)}
                            disabled={isDeleting}
                            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 disabled:opacity-50"
                            title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteService(svc)}
                            disabled={isDeleting}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50"
                            title="Delete">
                            {isDeleting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Add new service */}
            <form onSubmit={handleAddService} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newServiceLabel}
                onChange={(e) => setNewServiceLabel(e.target.value)}
                placeholder="e.g. Window Cleaning"
                disabled={addingService}
                className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={addingService || !newServiceLabel.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: BRAND_BLUE }}>
                {addingService
                  ? <Loader className="w-4 h-4 animate-spin" />
                  : <><Plus className="w-4 h-4" /> Add</>}
              </button>
            </form>
          </div>
        </section>

        {/* ── Roof Insights add-on (Pro · Google Solar) ─────────────── */}
        <div className="rounded-2xl p-4 shadow-sm border border-gray-100 bg-white mb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#EEF3FF' }}>
                <Sun className="w-4 h-4" style={{ color: BRAND_BLUE }} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-800 text-sm">Roof Insights</p>
                  {!isPro && <ProBadge />}
                  {roofOn && (
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#EEF3FF', color: BRAND_BLUE }}>On</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  Optional Pro add-on. Reps &amp; managers see each home's <span className="font-medium">roof size, complexity, pitch &amp; sun exposure</span> from satellite data on doors and leads.
                  Off by default — each lookup is a small Google Solar API charge, so only turn it on if your team uses roof data.
                </p>
              </div>
            </div>

            {isPro ? (
              <button
                onClick={handleToggleRoofInsights}
                disabled={savingRoofToggle}
                role="switch"
                aria-checked={!!org?.roof_insights_enabled}
                className="relative shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-50"
                style={{ backgroundColor: org?.roof_insights_enabled ? BRAND_BLUE : '#D1D5DB' }}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${org?.roof_insights_enabled ? 'translate-x-5' : ''}`} />
              </button>
            ) : (
              <button
                onClick={() => setShowRoofUpsell(true)}
                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl text-white"
                style={{ backgroundColor: BRAND_BLUE }}>
                Upgrade
              </button>
            )}
          </div>
        </div>

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
                {isPro ? 'Pro' : 'Standard'}{inTrial ? ' · Trial' : ''}
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
            {isOwner && org?.stripe_customer_id && (
              <button
                onClick={handleManageBilling}
                disabled={portalBusy}
                className="mt-2 w-full py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-gray-50 disabled:opacity-50">
                {portalBusy ? <Loader className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                {portalBusy ? 'Opening…' : 'Manage billing & invoices'}
              </button>
            )}
          </div>
        </section>

        {/* ── Pricing Plans ──────────────────────────────────────────── */}
        <section>
          <h2 className="text-gray-700 font-semibold text-base mb-3">Plans</h2>

          {/* Reverse-trial explainer. Every org runs on full Pro during the
              trial, then converts to the plan picked at signup. Without this,
              a Standard signup is baffled to see "Pro · Current Plan", then
              loses features at conversion. Only shown while in trial. */}
          {inTrial && (
            <div className="mb-3 rounded-2xl border p-4"
              style={{ backgroundColor: willDowngrade ? '#FFFBEB' : '#EFF6FF', borderColor: willDowngrade ? '#FDE68A' : '#BFDBFE' }}>
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: willDowngrade ? '#B45309' : BRAND_BLUE }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: willDowngrade ? '#92400E' : '#1E3A8A' }}>
                    You're on a free Pro trial{trialEndsLabel ? ` until ${trialEndsLabel}` : ''}
                  </p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: willDowngrade ? '#92400E' : '#1E40AF' }}>
                    Every trial gets full <span className="font-semibold">Pro</span> features to try out. When your trial
                    ends, your account switches to the <span className="font-semibold">{postTrialPlan === 'pro' ? 'Pro' : 'Standard'}</span> plan
                    you chose at signup — <span className="font-semibold">${postTrialPrice}/seat/mo</span>
                    {willDowngrade ? ', and Pro-only features (expanded pipeline, 51+ territories, exports, Zapier, commission tracking) will turn off.' : '.'}
                  </p>
                  {willDowngrade && (
                    <a
                      href="mailto:hello@knockiq.com?subject=Stay on Pro&body=Hi, I'd like to keep the Pro plan after my trial."
                      className="inline-block mt-2 text-xs font-bold"
                      style={{ color: BRAND_BLUE }}>
                      Keep Pro instead →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">

            {/* Standard Plan */}
            <div className={`bg-white rounded-2xl p-4 shadow-sm border-2 ${!isPro ? 'border-blue-500' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-bold text-gray-800 text-base">Standard</p>
                  <p className="text-gray-500 text-xs">For growing canvassing teams</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800 text-xl">$25<span className="text-sm font-normal text-gray-500">/seat/mo</span></p>
                  <p className="text-gray-400 text-xs">Billed monthly</p>
                </div>
              </div>
              <ul className="space-y-1.5 mt-3">
                {['Manager dashboard & live leaderboard', 'Automatic door tracking', 'Pipeline & lead management', 'Territory management', 'Commission tracking', 'Full game mechanics & cards', 'Up to 50 territories'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 flex-shrink-0" style={{ color: BRAND_LIME }} />
                    {f}
                  </li>
                ))}
              </ul>
              {(() => {
                // A downgrade is scheduled — surface it on the Standard card.
                if (pendingDowngrade) return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <span className="inline-flex items-center gap-1.5 text-amber-700 text-xs font-semibold bg-amber-50 px-3 py-1 rounded-full">
                      <Clock className="w-3.5 h-3.5" /> Starts at next renewal
                    </span>
                  </div>
                )
                // Standard is the current (or post-trial) plan → badge only.
                if ((!isPro && !inTrial) || willDowngrade) return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <span className="inline-flex items-center gap-1.5 text-blue-600 text-xs font-semibold bg-blue-50 px-3 py-1 rounded-full">
                      <CheckCircle className="w-3.5 h-3.5" /> {willDowngrade ? 'Your plan after trial' : 'Current Plan'}
                    </span>
                  </div>
                )
                // Owner on Pro (or a Pro trial) can move down to Standard.
                if (canSwitchPlans && (isPro || inTrial)) return (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <button type="button" onClick={() => openPlanModal('standard')}
                      className="block w-full py-2.5 rounded-xl text-center text-sm font-bold border-2 border-gray-200 text-gray-700 hover:border-gray-300 transition-colors">
                      {planSwitchIsExternal
                        ? 'Switch to Standard on web ↗'
                        : (inTrial ? 'Switch to Standard after trial' : 'Switch to Standard')}
                    </button>
                  </div>
                )
                return null
              })()}
            </div>

            {/* Pro Plan */}
            <div className={`rounded-2xl p-4 shadow-sm border-2 ${isPro ? 'border-blue-500 bg-white' : 'bg-white border-gray-100'}`}
              style={isPro ? {} : {}}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-gray-800 text-base">Pro</p>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: BRAND_LIME }}>
                      Most popular
                    </span>
                  </div>
                  <p className="text-gray-500 text-xs">For teams that need every lead to convert</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-800 text-xl">$50<span className="text-sm font-normal text-gray-500">/seat/mo</span></p>
                  <p className="text-gray-400 text-xs">Replaces Standard price</p>
                </div>
              </div>
              <ul className="space-y-1.5 mt-3">
                {['Everything in Standard', 'Expanded Pipeline View', '51+ territories', 'Export to CSV & Google Sheets', 'Zapier integration (6,000+ apps)', 'Phone support'].map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 flex-shrink-0" style={{ color: BRAND_LIME }} />
                    {f}
                  </li>
                ))}
              </ul>
              {!isPro ? (
                // Currently Standard. Owner gets a one-tap upgrade; everyone
                // else keeps the email fallback.
                <div className="mt-3 pt-3 border-t border-gray-100">
                  {canSwitchPlans ? (
                    <button type="button" onClick={() => openPlanModal('pro')}
                      className="btn-brand block w-full py-2.5 rounded-xl text-center text-sm font-bold">
                      {planSwitchIsExternal ? 'Upgrade to Pro on web ↗' : 'Upgrade to Pro →'}
                    </button>
                  ) : (
                    <a
                      href="mailto:hello@knockiq.com?subject=Upgrade to Pro&body=Hi, I'd like to upgrade my account to the Pro plan."
                      className="btn-brand block w-full py-2.5 rounded-xl text-center text-sm font-bold">
                      Contact to Upgrade → Pro
                    </a>
                  )}
                </div>
              ) : (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
                    style={(inTrial || pendingDowngrade) ? { backgroundColor: '#FEF3C7', color: '#92400E' } : { backgroundColor: '#EFF6FF', color: '#2563EB' }}>
                    <CheckCircle className="w-3.5 h-3.5" />
                    {pendingDowngrade
                      ? 'Current until renewal'
                      : inTrial
                        ? `Trial access${trialEndsLabel ? ` · until ${trialEndsLabel}` : ''}`
                        : 'Current Plan'}
                  </span>
                  {/* Cancel a scheduled downgrade. */}
                  {pendingDowngrade && (
                    <button type="button" onClick={() => openPlanModal('pro')}
                      className="btn-brand block w-full py-2.5 rounded-xl text-center text-sm font-bold">
                      {planSwitchIsExternal ? 'Keep Pro on web ↗' : 'Keep Pro instead'}
                    </button>
                  )}
                  {/* On a Pro trial that's set to drop to Standard — let the owner stay on Pro. */}
                  {inTrial && willDowngrade && canSwitchPlans && (
                    <button type="button" onClick={() => openPlanModal('pro')}
                      className="btn-brand block w-full py-2.5 rounded-xl text-center text-sm font-bold">
                      {planSwitchIsExternal ? 'Keep Pro on web ↗' : 'Keep Pro after trial'}
                    </button>
                  )}
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

            {/* Hover Help callout — step-by-step Zapier setup guide */}
            <span className="relative group ml-auto">
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-blue-600 transition-colors"
                aria-label="How to set up the Zapier webhook">
                <HelpCircle className="w-3.5 h-3.5" /> Setup guide
              </button>
              <div
                role="tooltip"
                className="invisible opacity-0 group-hover:visible group-hover:opacity-100 focus-within:visible focus-within:opacity-100 transition-opacity absolute right-0 top-6 z-30 w-72 bg-white border border-gray-200 rounded-2xl shadow-xl p-4 text-left">
                <p className="text-sm font-bold text-gray-800 mb-1.5">Connect KnockIQ to Zapier</p>
                <ol className="text-xs text-gray-600 leading-relaxed space-y-1 list-decimal pl-4">
                  <li>In Zapier, create a Zap and pick <span className="font-semibold">Webhooks by Zapier</span> as the trigger.</li>
                  <li>Choose the <span className="font-semibold">Catch Hook</span> event and continue.</li>
                  <li>Copy the <span className="font-semibold">Custom Webhook URL</span> Zapier gives you.</li>
                  <li>Paste it below and hit <span className="font-semibold">Save URL</span>.</li>
                  <li>Click <span className="font-semibold">Test</span> here — we send a sample session so Zapier learns every field.</li>
                  <li>Back in Zapier, add an action (Google Sheets, Slack, your CRM…) and map the fields.</li>
                  <li><span className="font-semibold">Publish</span> the Zap. Live data fires whenever a rep ends a session.</li>
                </ol>
                <p className="text-[11px] text-gray-400 mt-2">Tip: Test stays disabled until a URL is saved.</p>
              </div>
            </span>
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
                    Fires on the events you turn on below — each sends the relevant record to Zapier.
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

                {/* Per-event triggers — which events fire the webhook */}
                <div className="border border-gray-100 rounded-xl divide-y divide-gray-100">
                  <p className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 px-3 pt-3 pb-1">Trigger events</p>
                  {[
                    { key: 'session_ended', label: 'Session ended',        desc: 'When a rep ends a session (full summary)' },
                    { key: 'booking',       label: 'New booking',          desc: 'When a rep books a job' },
                    { key: 'appointment',   label: 'Appointment scheduled', desc: 'When a rep sets an appointment' },
                    { key: 'estimate',      label: 'Estimate requested',   desc: 'When a homeowner requests an estimate' },
                  ].map(ev => (
                    <div key={ev.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{ev.label}</p>
                        <p className="text-[11px] text-gray-400">{ev.desc}</p>
                      </div>
                      <button
                        onClick={() => handleToggleEvent(ev.key)}
                        role="switch"
                        aria-checked={!!webhookEvents[ev.key]}
                        aria-label={`Toggle ${ev.label} event`}
                        className="relative shrink-0 w-11 h-6 rounded-full transition-colors"
                        style={{ backgroundColor: webhookEvents[ev.key] ? BRAND_BLUE : '#D1D5DB' }}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${webhookEvents[ev.key] ? 'translate-x-5' : ''}`} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500">
                  <p className="font-semibold text-gray-600 mb-1">Example payload (session ended):</p>
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

          {/* ── Danger Zone (owner only) ──────────────────────────────────
              Pause is the seasonal-churn catcher and gets the prominent,
              friendly treatment; Cancel is the muted secondary. Both are
              owner-only — a non-owner manager doesn't see this card, and the
              edge function 403s them even if they did. */}
          {isOwner && (
            <div className="mt-5 rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-gray-500" />
                <p className="text-sm font-semibold text-gray-700">Manage subscription</p>
              </div>
              <div className="p-4 space-y-3 bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#E0E7FF' }}>
                    <PauseCircle className="w-4 h-4" style={{ color: BRAND_BLUE }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">Pause for the off-season</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      Going seasonal? Drop to a <span className="font-semibold text-gray-700">flat ${keepWarm}/mo</span> keep-warm
                      rate (not per seat) and keep everything — territories, reps, pipeline, and
                      history — ready for when you come back.
                    </p>
                    <button
                      onClick={() => setLifecycleModal('pause')}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
                      style={{ backgroundColor: BRAND_BLUE }}>
                      <PauseCircle className="w-3.5 h-3.5" /> Pause account
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100">
                  <button
                    onClick={() => setLifecycleModal('cancel')}
                    className="text-xs font-semibold text-red-500 hover:text-red-600 hover:underline">
                    Cancel account…
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="text-center text-gray-400 text-xs mt-4">
            Questions?{' '}
            <a href="mailto:hello@knockiq.com" className="text-blue-500 hover:underline">
              hello@knockiq.com
            </a>
          </p>
        </section>
      </div>

      {/* Account lifecycle modal — pause / cancel / delete flow */}
      {planModal && (() => {
        const COPY = {
          'upgrade': {
            title: 'Upgrade to Pro?',
            body: hasSubscription
              ? "Pro features unlock right away. You'll be charged the prorated difference for the rest of this billing period, then $50/seat/mo going forward."
              : 'Pro features turn on right away. No charge — this account isn’t on a paid subscription yet.',
            cta: 'Upgrade to Pro', danger: false,
          },
          'downgrade': {
            title: 'Switch to Standard?',
            body: hasSubscription
              ? 'You keep your Pro features until your current billing period ends, then move to Standard at $25/seat/mo. No partial refund.'
              : 'This account moves to Standard right away and Pro-only features turn off. No billing change — it isn’t on a paid subscription yet.',
            cta: 'Switch to Standard', danger: false,
          },
          'undo': {
            title: 'Keep Pro?',
            body: 'This cancels the scheduled switch to Standard. You stay on Pro at $50/seat/mo.',
            cta: 'Keep Pro', danger: false,
          },
          'trial-pro': {
            title: 'Start on Pro after your trial?',
            body: `When your free trial ends${trialEndsLabel ? ` on ${trialEndsLabel}` : ''}, you'll begin the Pro plan at $50/seat/mo.`,
            cta: 'Set Pro for after trial', danger: false,
          },
          'trial-standard': {
            title: 'Start on Standard after your trial?',
            body: `When your free trial ends${trialEndsLabel ? ` on ${trialEndsLabel}` : ''}, you'll begin Standard at $25/seat/mo and Pro-only features (expanded pipeline, 51+ territories, exports, Zapier) will turn off.`,
            cta: 'Set Standard for after trial', danger: true,
          },
        }[planModal.kind] || { title: 'Change plan?', body: '', cta: 'Confirm', danger: false }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
            onClick={() => !planBusy && setPlanModal(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900">{COPY.title}</h3>
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">{COPY.body}</p>
              <div className="mt-5 flex gap-2">
                <button type="button" disabled={planBusy} onClick={() => setPlanModal(null)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 bg-white disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" disabled={planBusy} onClick={confirmPlanChange}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 ${COPY.danger ? 'bg-amber-600 hover:bg-amber-700' : 'btn-brand'}`}>
                  {planBusy ? 'Working…' : COPY.cta}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {lifecycleModal && (
        <AccountLifecycleModal
          mode={lifecycleModal}
          org={org}
          onClose={() => setLifecycleModal(null)}
          onPaused={async () => {
            // Re-read the profile so the App-level gate catches the paused
            // status and routes the owner to the AccountInactive screen.
            await refreshUser()
          }}
          onCancelled={async () => {
            await refreshUser()
          }}
          onDeleted={async () => {
            await signOut()
          }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

/* ── Account Lifecycle Modal ─────────────────────────────────────────────────
 * Owner-only pause / cancel / delete flow. The cancel path is a reason-matched
 * save funnel: pick a reason → see an offer tuned to that reason (seasonal →
 * pause, too-expensive → downgrade, too-hard → support) → only then confirm
 * cancellation, with a final typed-confirm "delete permanently" escape hatch.
 *
 * State transitions on success route through the parent's onPaused/onCancelled/
 * onDeleted, which refresh auth (so the App gate takes over) or sign out.
 */
const CANCEL_REASONS = [
  { key: 'seasonal',  label: "We're going seasonal / off-season" },
  { key: 'expensive', label: 'Too expensive' },
  { key: 'too_hard',  label: 'Too hard to use' },
  { key: 'missing',   label: 'Missing features we need' },
  { key: 'other',     label: 'Something else' },
]

function defaultResumeDate() {
  // Default a pause to ~3 months out — a typical off-season gap. Formatted
  // as yyyy-mm-dd for the native date input.
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

function AccountLifecycleModal({ mode, org, onClose, onPaused, onCancelled, onDeleted, showToast }) {
  // step: 'pause' | 'reason' | 'offer' | 'confirm_cancel' | 'delete'
  const [step, setStep] = useState(mode === 'pause' ? 'pause' : 'reason')
  const [reason, setReason] = useState(null)
  const [resumeDate, setResumeDate] = useState(defaultResumeDate())
  const [noResumeDate, setNoResumeDate] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const keepWarm = org?.pause_fee_cents != null ? (org.pause_fee_cents / 100) : 15

  async function doPause(reasonKey) {
    setBusy(true)
    const { error } = await pauseOrganization({
      resumeAt: noResumeDate ? null : resumeDate,
      reason:   reasonKey || 'seasonal',
    })
    setBusy(false)
    if (error) { showToast('Could not pause: ' + error.message, 'error'); return }
    showToast('Account paused — your data is safe.')
    await onPaused?.()
    onClose()
  }

  async function doCancel() {
    setBusy(true)
    const { error } = await cancelOrganization({ reason: reason || 'unspecified' })
    setBusy(false)
    if (error) { showToast('Could not cancel: ' + error.message, 'error'); return }
    showToast('Account cancelled. You can reactivate within 90 days.')
    await onCancelled?.()
    onClose()
  }

  async function doDelete() {
    setBusy(true)
    const { error } = await deleteOrganization()
    // Don't clear busy on success — the session is about to die.
    if (error) { setBusy(false); showToast('Could not delete: ' + error.message, 'error'); return }
    await onDeleted?.()
  }

  // The save offer shown for each cancel reason.
  function renderOffer() {
    const continueBtn = (
      <button
        onClick={() => setStep('confirm_cancel')}
        className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50">
        No thanks, continue to cancel
      </button>
    )

    if (reason === 'seasonal') {
      return (
        <>
          <ModalHeader icon={PauseCircle} iconBg="#E0E7FF" iconColor={BRAND_BLUE}
            title="Pause instead of cancel" />
          <p className="text-sm text-gray-600 leading-relaxed">
            Perfect fit for a seasonal break. Pausing keeps your territories, reps,
            pipeline, and full history intact and drops billing to a{' '}
            <span className="font-semibold text-gray-800">flat ${keepWarm}/mo</span> keep-warm
            rate (not per seat). Reactivate in one tap when the season picks back up — nothing to rebuild.
          </p>
          <PauseDateControls
            resumeDate={resumeDate} setResumeDate={setResumeDate}
            noResumeDate={noResumeDate} setNoResumeDate={setNoResumeDate} />
          <button
            onClick={() => doPause('seasonal')}
            disabled={busy}
            className="btn-brand w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2">
            {busy ? <Loader className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
            Pause my account
          </button>
          {continueBtn}
        </>
      )
    }

    if (reason === 'expensive') {
      return (
        <>
          <ModalHeader icon={DollarSign} iconBg="#ECFDF5" iconColor="#059669"
            title="Before you go — a cheaper option" />
          <p className="text-sm text-gray-600 leading-relaxed">
            If price is the issue, you can switch to the <span className="font-semibold text-gray-800">Standard</span> plan
            (lower per-seat cost) instead of leaving, or pause billing to a{' '}
            <span className="font-semibold text-gray-800">flat ${keepWarm}/mo</span> keep-warm rate and keep all your data.
          </p>
          <a
            href="mailto:hello@knockiq.com?subject=Switch%20to%20Standard%20plan&body=Hi,%20I'd%20like%20to%20move%20my%20account%20to%20the%20Standard%20plan."
            className="block w-full py-2.5 rounded-xl text-center text-sm font-bold text-white" style={{ backgroundColor: '#059669' }}>
            Talk to us about Standard
          </a>
          <button
            onClick={() => setStep('pause')}
            className="w-full py-2.5 rounded-xl border text-sm font-semibold"
            style={{ borderColor: BRAND_BLUE, color: BRAND_BLUE }}>
            Pause instead (flat ${keepWarm}/mo)
          </button>
          {continueBtn}
        </>
      )
    }

    if (reason === 'too_hard') {
      return (
        <>
          <ModalHeader icon={MessageSquare} iconBg="#EFF6FF" iconColor={BRAND_BLUE}
            title="Let us help before you go" />
          <p className="text-sm text-gray-600 leading-relaxed">
            Most "too hard" issues are a 10-minute fix. We'll walk you or your team
            through setup personally — no charge. Or pause your account so you don't
            lose anything while you decide.
          </p>
          <a
            href="mailto:hello@knockiq.com?subject=Help%20getting%20set%20up&body=Hi,%20we're%20having%20trouble%20with%20setup.%20Can%20you%20help?"
            className="btn-brand block w-full py-2.5 rounded-xl text-center text-sm font-bold">
            Get setup help
          </a>
          <button
            onClick={() => setStep('pause')}
            className="w-full py-2.5 rounded-xl border text-sm font-semibold"
            style={{ borderColor: BRAND_BLUE, color: BRAND_BLUE }}>
            Pause instead
          </button>
          {continueBtn}
        </>
      )
    }

    // 'missing' or 'other' — lighter offer: pause as the data-safe alternative.
    return (
      <>
        <ModalHeader icon={PauseCircle} iconBg="#E0E7FF" iconColor={BRAND_BLUE}
          title="Pause instead — keep your data" />
        <p className="text-sm text-gray-600 leading-relaxed">
          {reason === 'missing'
            ? "We'd love to hear what's missing — reply to any of our emails and it goes straight to the team."
            : 'If this might be temporary, pausing keeps everything intact at a low keep-warm rate so you can come back anytime.'}
        </p>
        <button
          onClick={() => setStep('pause')}
          className="w-full py-2.5 rounded-xl border text-sm font-semibold"
          style={{ borderColor: BRAND_BLUE, color: BRAND_BLUE }}>
          Pause instead (flat ${keepWarm}/mo)
        </button>
        {continueBtn}
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        {/* Close */}
        <div className="flex justify-end -mb-2">
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── PAUSE (direct, or chosen from an offer) ── */}
        {step === 'pause' && (
          <>
            <ModalHeader icon={PauseCircle} iconBg="#E0E7FF" iconColor={BRAND_BLUE}
              title="Pause your account" />
            <p className="text-sm text-gray-600 leading-relaxed">
              Billing pauses to a <span className="font-semibold text-gray-800">flat ${keepWarm}/mo</span> keep-warm
              rate (not per seat). Your team won't be able to canvass while paused, but everything —
              territories, reps, pipeline, history — stays exactly as you left it.
            </p>
            <PauseDateControls
              resumeDate={resumeDate} setResumeDate={setResumeDate}
              noResumeDate={noResumeDate} setNoResumeDate={setNoResumeDate} />
            <button
              onClick={() => doPause('seasonal')}
              disabled={busy}
              className="btn-brand w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2">
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
              Pause account
            </button>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium">
              Never mind
            </button>
          </>
        )}

        {/* ── CANCEL: reason ── */}
        {step === 'reason' && (
          <>
            <ModalHeader icon={AlertTriangle} iconBg="#FEF3C7" iconColor="#D97706"
              title="Cancel account" />
            <p className="text-sm text-gray-600">
              Sorry to see you thinking about leaving. What's the main reason? This
              helps us — and lets us point you to the best option.
            </p>
            <div className="space-y-2">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { setReason(r.key); setStep('offer') }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  {r.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── CANCEL: reason-matched save offer ── */}
        {step === 'offer' && renderOffer()}

        {/* ── CANCEL: final confirm ── */}
        {step === 'confirm_cancel' && (
          <>
            <ModalHeader icon={XCircle} iconBg="#FEE2E2" iconColor="#DC2626"
              title="Confirm cancellation" />
            <p className="text-sm text-gray-600 leading-relaxed">
              Your subscription stops and the app turns off for your whole team. We'll
              keep your data for <span className="font-semibold text-gray-800">90 days</span> so you can
              reactivate and pick up where you left off — after that it's permanently deleted.
            </p>
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
              <PauseCircle className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800">
                Just need a break? <button onClick={() => setStep('pause')} className="font-bold underline">Pause instead</button> and keep billing at the keep-warm rate.
              </p>
            </div>
            <button
              onClick={doCancel}
              disabled={busy}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ backgroundColor: '#DC2626' }}>
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : null}
              Cancel my account
            </button>
            <button
              onClick={() => setStep('delete')}
              className="w-full text-center text-xs text-gray-400 hover:text-red-500 hover:underline">
              Or delete everything permanently now →
            </button>
          </>
        )}

        {/* ── DELETE: typed confirm ── */}
        {step === 'delete' && (
          <>
            <ModalHeader icon={Trash2} iconBg="#FEE2E2" iconColor="#DC2626"
              title="Delete permanently" />
            <p className="text-sm text-gray-600 leading-relaxed">
              This <span className="font-semibold text-red-600">immediately and permanently</span> deletes
              your organization, every rep and closer account, and all data. There's no
              90-day grace and no undo. To confirm, type <span className="font-mono font-bold">DELETE</span> below.
            </p>
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-red-300"
            />
            <button
              onClick={doDelete}
              disabled={busy || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ backgroundColor: '#DC2626' }}>
              {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Permanently delete everything
            </button>
            <button onClick={() => setStep('confirm_cancel')} className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium">
              Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function ModalHeader({ icon: Icon, iconBg, iconColor, title }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: iconBg }}>
        <Icon className="w-5 h-5" style={{ color: iconColor }} />
      </div>
      <h3 className="font-bold text-gray-900 text-base">{title}</h3>
    </div>
  )
}

function PauseDateControls({ resumeDate, setResumeDate, noResumeDate, setNoResumeDate }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2.5">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Calendar className="w-4 h-4 text-gray-400" />
        Auto-resume on
      </label>
      <input
        type="date"
        value={resumeDate}
        min={today}
        disabled={noResumeDate}
        onChange={(e) => setResumeDate(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
        <input type="checkbox" checked={noResumeDate} onChange={(e) => setNoResumeDate(e.target.checked)} />
        No set date — I'll turn it back on manually
      </label>
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
