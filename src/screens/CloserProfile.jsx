/**
 * CloserProfile — minimal settings screen for closer-role users.
 *
 * Lives at /closer/profile. Reached from the gear icon in CloserHome.
 *
 * Only one configurable thing right now: notification preference (where
 * the closer wants new-lead alerts delivered). Identity (name, email,
 * phone) is read-only here — managers own the team roster from Settings →
 * Closers. Logout is the other escape hatch.
 *
 * As the hybrid model matures we may add things like:
 *  • A "do not disturb" window (no SMS at night)
 *  • Per-service-type opt-outs
 *  • A weekly summary email toggle
 * For now we keep this focused to avoid the trap of building a CRM
 * preferences page before we know which prefs actually matter.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Bell, Mail, Smartphone, MessageSquare,
  Check, Loader2, LogOut,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  updateCloserNotificationPref, signOut,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

const PREF_OPTIONS = [
  {
    id:          'email',
    label:       'Email',
    icon:        Mail,
    description: 'Get an email each time a setter assigns you a lead. Default for new closers.',
  },
  {
    id:          'sms',
    label:       'SMS',
    icon:        MessageSquare,
    description: 'Get a text message. Fastest channel — best if you live in your phone and rarely check email.',
  },
  {
    id:          'app',
    label:       'In-app only',
    icon:        Smartphone,
    description: 'No email or SMS. You\'ll see new leads next time you open the inbox. Quietest option.',
  },
  {
    id:          'both',
    label:       'Email + SMS',
    icon:        Bell,
    description: 'Belt and suspenders. Both channels fire for every new lead. Loudest option.',
  },
]

export default function CloserProfile() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [pref,    setPref]    = useState(user?.closer_notification_pref || 'email')
  const [saving,  setSaving]  = useState(false)
  const [toast,   setToast]   = useState(null)

  // Keep local pref in sync if the auth context refreshes.
  useEffect(() => {
    if (user?.closer_notification_pref && user.closer_notification_pref !== pref) {
      setPref(user.closer_notification_pref)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.closer_notification_pref])

  async function handlePick(nextPref) {
    if (nextPref === pref || !user?.id) return
    const prev = pref
    setPref(nextPref) // optimistic
    setSaving(true)
    const { error } = await updateCloserNotificationPref(user.id, nextPref)
    setSaving(false)
    if (error) {
      setPref(prev)
      setToast({ type: 'error', text: error.message || 'Save failed' })
    } else {
      setToast({ type: 'success', text: 'Saved' })
    }
    setTimeout(() => setToast(null), 2200)
  }

  async function handleLogout() {
    if (!window.confirm('Log out?')) return
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">

      {/* Header */}
      <div
        className="px-5 pt-10 pb-6"
        style={{ background: 'linear-gradient(135deg, #1B4FCC 0%, #4338CA 55%, #6D28D9 100%)' }}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={() => navigate('/closer')}
            className="p-2 rounded-full bg-white/20 active:bg-white/30 shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-blue-100 text-xs">Closer · Profile</p>
            <h1 className="text-white text-xl font-bold truncate leading-tight">
              {user?.full_name || 'You'}
            </h1>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto w-full px-4 pt-6 space-y-5">

        {/* Identity (read-only) */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm">
          <div className="px-5 pt-4 pb-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-900">Your details</h2>
            <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
              Ask your manager to update these from Settings → Closers.
            </p>
          </div>
          <dl className="px-5 py-3 text-sm">
            <Row label="Name"  value={user?.full_name || '—'} />
            <Row label="Email" value={user?.email     || '—'} />
            {user?.phone && <Row label="Phone" value={user.phone} />}
          </dl>
        </section>

        {/* Notification preference */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center" style={{ color: BRAND_BLUE }}>
                <Bell className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-gray-900">Notify me about new leads via</h2>
            </div>
            <p className="text-[12px] text-gray-500 mt-1.5 leading-snug">
              Pick how you want to hear about leads assigned to you. You can always
              change this later.
            </p>
          </div>
          <div className="px-5 py-4 space-y-2">
            {PREF_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const active = opt.id === pref
              return (
                <button
                  key={opt.id}
                  onClick={() => handlePick(opt.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50/60'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-semibold ${active ? 'text-blue-900' : 'text-gray-900'}`}>
                        {opt.label}
                      </p>
                      <p className="text-[12px] text-gray-500 mt-0.5 leading-snug">
                        {opt.description}
                      </p>
                    </div>
                    {active && (
                      <Check className="w-4 h-4 text-blue-600 mt-1 shrink-0" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-3.5 flex items-center gap-3 text-red-600 hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-sm font-bold">Log out</span>
        </button>

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

      {saving && (
        <div className="fixed bottom-6 right-6 z-40 bg-white border border-gray-200 shadow-sm rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs text-gray-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Saving…
        </div>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-50 last:border-b-0">
      <dt className="text-[12px] uppercase tracking-wide font-semibold text-gray-400">{label}</dt>
      <dd className="text-sm font-semibold text-gray-800 text-right truncate ml-3">{value}</dd>
    </div>
  )
}
