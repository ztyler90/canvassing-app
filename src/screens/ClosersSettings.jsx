/**
 * ClosersSettings — manager-only screen for managing the closer roster.
 *
 * Lives at /settings/closers. Reached from Settings → "Closers" tile.
 *
 * Two closer tiers live side-by-side in one unified list with badges:
 *
 *   • Email-only contact (default) — no auth account, no platform seat.
 *     Gets the lead-assigned email notification. Light footprint, free.
 *
 *   • Platform user — full role='closer' account, can log into the
 *     Closer Inbox at /closer to manage their leads themselves. Takes
 *     a seat under the org's pricing tier.
 *
 * Managers pick the tier when adding; email-only is the default. They
 * can promote an email-only contact to a platform user later with one
 * click (preserves any active lead assignments).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, UserCheck, Plus, X, Trash2, Mail, Bell, Smartphone,
  MessageSquare, Send, Loader2, Check, ArrowUpRight, Edit2,
} from 'lucide-react'
import {
  getAllClosersUnified,
  createCloser,                  // platform-tier add
  createCloserContact,           // email-only add
  updateCloserContact,
  deleteCloserContact,
  promoteCloserContactToPlatform,
  deleteRep, resendRepInvite,
  updateCloserNotificationPref,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

// Notification channels available on EACH tier. Email-only contacts
// can't pick 'app' (they have no app), so we filter that option out
// when rendering rows for that tier.
const PREF_OPTIONS = [
  { id: 'email', label: 'Email',     icon: Mail            },
  { id: 'sms',   label: 'SMS',       icon: MessageSquare    },
  { id: 'app',   label: 'App',       icon: Smartphone, platformOnly: true },
  { id: 'both',  label: 'Email+SMS', icon: Bell             },
]

export default function ClosersSettings() {
  const navigate = useNavigate()

  const [closers,     setClosers]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showAdd,     setShowAdd]     = useState(false)
  const [name,        setName]        = useState('')
  const [email,       setEmail]       = useState('')
  const [phone,       setPhone]       = useState('')
  const [tier,        setTier]        = useState('contact')   // 'contact' (default) | 'platform'
  const [adding,      setAdding]      = useState(false)
  const [busyId,      setBusyId]      = useState(null)         // id mid-action
  const [toast,       setToast]       = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setClosers(await getAllClosersUnified())
    setLoading(false)
  }

  function showToast(text, type = 'success') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 2400)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setAdding(true)
    if (tier === 'contact') {
      const { error } = await createCloserContact({
        fullName: name, email, phone: phone || undefined,
      })
      setAdding(false)
      if (error) { showToast(error.message || 'Add failed', 'error'); return }
      showToast('Contact added — they\'ll get an email on next assignment')
    } else {
      const { error, emailSent, emailError } = await createCloser({
        fullName: name, email, phone: phone || undefined, mode: 'invite',
      })
      setAdding(false)
      if (error) { showToast(error.message || 'Invite failed', 'error'); return }
      showToast(emailSent ? 'Platform invite sent' : `Created. Email: ${emailError || 'failed'}`,
                emailSent ? 'success' : 'error')
    }
    setName(''); setEmail(''); setPhone('')
    setTier('contact')
    setShowAdd(false)
    await load()
  }

  async function handleDelete(closer) {
    const label = closer.tier === 'platform' ? 'platform user' : 'email-only contact'
    if (!window.confirm(`Remove ${closer.full_name || closer.email} (${label})?`)) return
    setBusyId(closer.id)
    const { error } = closer.tier === 'platform'
      ? await deleteRep(closer.id)
      : await deleteCloserContact(closer.id)
    setBusyId(null)
    if (error) { showToast(error.message || 'Delete failed', 'error'); return }
    showToast('Removed')
    await load()
  }

  async function handleResend(closer) {
    // Only meaningful for platform users — email-only contacts don't have
    // an invite link to re-send.
    setBusyId(closer.id)
    const { error, emailSent } = await resendRepInvite(closer.id)
    setBusyId(null)
    showToast((error || !emailSent) ? (error?.message || 'Resend failed') : 'Invite re-sent',
              (error || !emailSent) ? 'error' : 'success')
  }

  async function handlePromote(closer) {
    if (!window.confirm(
      `Promote ${closer.full_name} to a platform user?\n\n` +
      `They'll receive an invite email and be able to log in to the Closer Inbox. ` +
      `Their existing lead assignments are preserved.`
    )) return
    setBusyId(closer.id)
    const { error, emailSent } = await promoteCloserContactToPlatform(closer.id)
    setBusyId(null)
    if (error) { showToast(error.message || 'Promote failed', 'error'); return }
    showToast(emailSent ? 'Promoted — invite email sent' : 'Promoted (email delivery failed)',
              emailSent ? 'success' : 'error')
    await load()
  }

  async function handlePrefChange(closer, pref) {
    // Optimistic update for snappy chips on slow networks.
    setClosers((cs) =>
      cs.map((c) => c.id === closer.id ? { ...c, notification_pref: pref } : c)
    )
    const { error } = closer.tier === 'platform'
      ? await updateCloserNotificationPref(closer.id, pref)
      : await updateCloserContact(closer.id, { notificationPref: pref })
    if (error) {
      showToast(error.message || 'Update failed', 'error')
      await load() // revert via re-fetch
    }
  }

  const platformCount = closers.filter((c) => c.tier === 'platform').length
  const contactCount  = closers.filter((c) => c.tier === 'contact').length

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
            <p className="text-blue-100 text-xs">Settings · Closers</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              Closers
            </h1>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-6 space-y-4">

        {/* Explainer card */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 text-[12px] text-blue-900 leading-snug">
          <p className="font-bold mb-1">Two closer tiers</p>
          <p>
            <span className="font-semibold">Email-only contacts</span> get a lead notification email when a setter assigns
            them an appointment. They don't log in and don't take a platform seat.{' '}
            <span className="font-semibold">Platform users</span> can log into the Closer Inbox to manage their
            leads directly — best when you want them updating stages, adding notes, or marking lost reasons.
          </p>
        </div>

        {/* Header row + add button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <UserCheck className="w-4 h-4" style={{ color: BRAND_BLUE }} />
            <h2 className="text-sm font-bold text-gray-800">Your closers</h2>
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
              Add closer
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
              <p className="text-sm font-bold text-gray-900">Add a closer</p>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setName(''); setEmail(''); setPhone(''); setTier('contact') }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tier picker — email-only is the default */}
            <div className="space-y-2">
              <TierOption
                id="contact"
                active={tier === 'contact'}
                onPick={setTier}
                title="Email-only contact"
                badge="Default · Free"
                description="They'll get an email each time you assign them a lead. No login, no seat."
              />
              <TierOption
                id="platform"
                active={tier === 'platform'}
                onPick={setTier}
                title="Platform user"
                badge="Uses a seat"
                description="They'll get an invite to log into the Closer Inbox. Can update stages and notes themselves."
              />
            </div>

            <Input value={name}  onChange={setName}  placeholder="Full name"     required />
            <Input value={email} onChange={setEmail} placeholder="Email address" type="email" required />
            <Input value={phone} onChange={setPhone} placeholder="Phone (optional)" type="tel" />

            <button
              type="submit"
              disabled={adding || !name.trim() || !email.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: BRAND_BLUE }}
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {tier === 'platform' ? 'Send platform invite' : 'Add contact'}
            </button>
          </form>
        )}

        {/* Closer list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          </div>
        ) : closers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-8 text-center">
            <UserCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-gray-700">No closers yet</p>
            <p className="text-[12px] text-gray-500 mt-1 leading-snug max-w-xs mx-auto">
              Add an email-only contact in seconds — they'll get notified the next time a
              setter routes them a lead. Skip if your reps close their own deals.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {closers.map((c) => (
              <CloserRow
                key={`${c.tier}:${c.id}`}
                closer={c}
                busy={busyId === c.id}
                onResend={() => handleResend(c)}
                onDelete={() => handleDelete(c)}
                onPromote={() => handlePromote(c)}
                onPrefChange={(p) => handlePrefChange(c, p)}
              />
            ))}
          </div>
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
        active
          ? 'border-blue-600 bg-blue-50/60'
          : 'border-gray-200 bg-white hover:bg-gray-50'
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
              id === 'contact'
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
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

function CloserRow({ closer, busy, onResend, onDelete, onPromote, onPrefChange }) {
  const isPlatform = closer.tier === 'platform'
  const pref = closer.notification_pref || 'email'
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5">
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-full text-sm font-bold flex items-center justify-center shrink-0 ${
          isPlatform ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
        }`}>
          {(closer.full_name || closer.email || 'C')[0].toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{closer.full_name || '—'}</p>
            <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
              isPlatform
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {isPlatform ? 'Platform' : 'Email-only'}
            </span>
          </div>
          <p className="text-[12px] text-gray-500 truncate">{closer.email}</p>
          {closer.phone && (
            <p className="text-[11px] text-gray-400 truncate">{closer.phone}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isPlatform && (
            <button
              onClick={onPromote}
              disabled={busy}
              title="Promote to platform user (sends invite)"
              className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
            </button>
          )}
          {isPlatform && (
            <button
              onClick={onResend}
              disabled={busy}
              title="Resend invite email"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={busy}
            title="Remove closer"
            className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Notification pref chips */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase font-bold tracking-wider text-gray-400">Notify via</span>
        {PREF_OPTIONS
          .filter((opt) => !(opt.platformOnly && !isPlatform))
          .map((opt) => {
            const active = opt.id === pref
            const Icon = opt.icon
            return (
              <button
                key={opt.id}
                onClick={() => !active && onPrefChange(opt.id)}
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
    </div>
  )
}
