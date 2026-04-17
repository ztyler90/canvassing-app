/**
 * RepProfile — profile & account settings for reps.
 * Accessible from RepHome → gear icon in header.
 *
 * Features:
 *  - Edit display name
 *  - View / change email (triggers confirmation flow)
 *  - Send password reset email
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, User, Mail, Lock, Check, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { updateUserProfile, sendPasswordReset } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

export default function RepProfile() {
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()

  const [fullName, setFullName]     = useState(user?.full_name || '')
  const [email, setEmail]           = useState(user?.email     || '')
  const [saving, setSaving]         = useState(false)
  const [resetSent, setResetSent]   = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [toast, setToast]           = useState(null)

  const nameChanged  = fullName.trim() !== (user?.full_name || '')
  const emailChanged = email.trim()    !== (user?.email     || '')
  const hasChanges   = nameChanged || emailChanged

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function handleSave() {
    if (!hasChanges) return
    setSaving(true)
    const updates = {}
    if (nameChanged)  updates.fullName = fullName.trim()
    if (emailChanged) updates.email    = email.trim()

    const { error } = await updateUserProfile(updates)
    setSaving(false)

    if (error) {
      showToast(error.message || 'Save failed — please try again.', 'error')
    } else {
      await refreshUser?.()
      if (emailChanged) {
        showToast('Check your new email address to confirm the change.')
      } else {
        showToast('Profile updated!')
      }
    }
  }

  async function handlePasswordReset() {
    setResetting(true)
    const { error } = await sendPasswordReset(user?.email || email)
    setResetting(false)
    if (error) {
      showToast('Could not send reset email: ' + error.message, 'error')
    } else {
      setResetSent(true)
      showToast(`Reset email sent to ${user?.email || email}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-white text-sm font-medium shadow-lg transition-all ${toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="px-4 pt-12 pb-5" style={{ backgroundColor: BRAND_BLUE }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-white/20">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
          <div>
            <p className="text-blue-200 text-xs">Account</p>
            <h1 className="text-white font-bold text-lg">Profile & Settings</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-5 pb-10 max-w-lg mx-auto w-full">

        {/* Avatar / name display */}
        <div className="flex items-center gap-4 bg-white rounded-2xl px-4 py-4 shadow-sm border border-gray-100">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0"
            style={{ backgroundColor: BRAND_BLUE }}
          >
            {(fullName || user?.full_name || '?')[0].toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-gray-900 text-base">{user?.full_name || '—'}</p>
            <p className="text-gray-400 text-sm">{user?.email || '—'}</p>
            <span
              className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: '#EFF6FF', color: BRAND_BLUE }}
            >
              Rep
            </span>
          </div>
        </div>

        {/* Edit fields */}
        <section>
          <h2 className="text-gray-600 font-semibold text-sm mb-3 uppercase tracking-wide">Edit Info</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50 overflow-hidden">

            {/* Full name */}
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400 font-medium block mb-1.5">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>

            {/* Email */}
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400 font-medium block mb-1.5">
                Email Address
                {emailChanged && (
                  <span className="ml-2 text-amber-500 font-normal normal-case">
                    · confirmation email will be sent
                  </span>
                )}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="mt-3 w-full py-3.5 rounded-2xl text-white font-bold text-sm disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: BRAND_BLUE }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </section>

        {/* Password reset */}
        <section>
          <h2 className="text-gray-600 font-semibold text-sm mb-3 uppercase tracking-wide">Security</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-gray-800 font-semibold text-sm">Change Password</p>
                <p className="text-gray-400 text-xs mt-0.5">We'll email you a secure reset link</p>
              </div>
            </div>
            <button
              onClick={handlePasswordReset}
              disabled={resetting || resetSent}
              className="w-full py-3 rounded-xl border-2 text-sm font-semibold transition-colors disabled:opacity-50"
              style={resetSent
                ? { borderColor: '#10B981', color: '#10B981', backgroundColor: '#ECFDF5' }
                : { borderColor: BRAND_BLUE, color: BRAND_BLUE, backgroundColor: 'white' }
              }
            >
              {resetting ? 'Sending…' : resetSent ? '✓ Reset Email Sent' : 'Send Password Reset Email'}
            </button>
          </div>
        </section>

        {/* Help */}
        <p className="text-center text-gray-400 text-xs pb-4">
          Need help?{' '}
          <a href="mailto:hello@knockiq.com" className="text-blue-500 hover:underline">
            hello@knockiq.com
          </a>
        </p>
      </div>
    </div>
  )
}
