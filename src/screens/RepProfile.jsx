/**
 * RepProfile — profile & account settings for reps.
 * Accessible from RepHome → gear icon in header.
 *
 * Features:
 *  - Edit display name
 *  - View / change email (triggers confirmation flow)
 *  - Send password reset email
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, User, Mail, Lock, Camera, Bell, Sparkles } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import {
  updateUserProfile, sendPasswordReset, uploadAvatar,
} from '../lib/supabase.js'
import { usePrefs, setPref } from '../lib/prefs.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

export default function RepProfile() {
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()

  const [fullName, setFullName]     = useState(user?.full_name || '')
  const [email, setEmail]           = useState(user?.email     || '')
  const [saving, setSaving]         = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarUrl, setAvatarUrl]   = useState(user?.avatar_url || '')
  const [resetSent, setResetSent]   = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [toast, setToast]           = useState(null)
  const fileInputRef = useRef(null)
  const prefs = usePrefs()

  const nameChanged  = fullName.trim() !== (user?.full_name || '')
  const emailChanged = email.trim()    !== (user?.email     || '')
  const hasChanges   = nameChanged || emailChanged

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Wrap a promise so it rejects after `ms` — guarantees finally always runs
  // even if the underlying supabase call deadlocks on Web Locks.
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out`)), ms)
      ),
    ])
  }

  async function handleSave() {
    if (!hasChanges) return
    setSaving(true)
    try {
      const updates = {}
      if (nameChanged)  updates.fullName = fullName.trim()
      if (emailChanged) updates.email    = email.trim()

      const { error } = await withTimeout(updateUserProfile(updates), 15000, 'Save')

      if (error) {
        showToast(error.message || 'Save failed — please try again.', 'error')
      } else {
        try { await withTimeout(refreshUser?.(), 5000, 'Refresh') } catch { /* ignore */ }
        if (emailChanged) {
          showToast('Check your new email address to confirm the change.')
        } else {
          showToast('Profile updated!')
        }
      }
    } catch (err) {
      showToast(err.message || 'Save failed — please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0]
    // Clear the input value so picking the same file twice still fires onChange
    if (e.target) e.target.value = ''
    if (!file) return
    if (!/^image\//.test(file.type)) {
      showToast('Please pick an image file.', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5 MB.', 'error')
      return
    }

    setUploadingAvatar(true)
    try {
      const publicUrl = await withTimeout(uploadAvatar(file), 30000, 'Upload')
      if (!publicUrl) {
        showToast('Upload failed — please try again.', 'error')
        return
      }
      const { error } = await withTimeout(
        updateUserProfile({ avatarUrl: publicUrl }),
        15000,
        'Save',
      )
      if (error) {
        showToast(error.message || 'Could not save avatar.', 'error')
        return
      }
      // Show new avatar immediately — don't wait on refreshUser in case it hangs
      setAvatarUrl(publicUrl)
      showToast('Profile picture updated!')
      try { await withTimeout(refreshUser?.(), 5000, 'Refresh') } catch { /* ignore */ }
    } catch (err) {
      showToast(err.message || 'Upload failed — please try again.', 'error')
    } finally {
      setUploadingAvatar(false)
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
      <div className="px-4 pt-12 pb-5 bg-brand-header">
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
          {/* Avatar with camera overlay to change picture */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="relative w-16 h-16 rounded-full overflow-hidden shrink-0 group focus:outline-none focus:ring-2 focus:ring-blue-300"
            style={{ backgroundColor: avatarUrl ? 'transparent' : BRAND_BLUE }}
            aria-label="Change profile picture"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-white text-xl font-bold">
                {(fullName || user?.full_name || '?')[0].toUpperCase()}
              </span>
            )}

            {/* Camera overlay */}
            <span
              className={
                'absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ' +
                (uploadingAvatar ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-active:opacity-100')
              }
            >
              {uploadingAvatar ? (
                <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <Camera className="w-5 h-5 text-white" />
              )}
            </span>
          </button>

          {/* Hidden file input driven by the avatar button above */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarPick}
          />

          <div className="min-w-0 flex-1">
            <p className="font-bold text-gray-900 text-base truncate">{user?.full_name || '—'}</p>
            <p className="text-gray-400 text-sm truncate">{user?.email || '—'}</p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#EFF6FF', color: BRAND_BLUE }}
              >
                Rep
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50"
              >
                {uploadingAvatar ? 'Uploading…' : 'Change photo'}
              </button>
            </div>
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
            className="btn-brand mt-3 w-full py-3.5 rounded-2xl font-bold text-sm"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </section>

        {/* Preferences — device-local, stored in localStorage */}
        <section>
          <h2 className="text-gray-600 font-semibold text-sm mb-3 uppercase tracking-wide">Preferences</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="pref-auto-open" className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className="block">
                    <span className="block text-gray-800 font-semibold text-sm">
                      Auto-open Log Interaction
                    </span>
                    <span className="block text-gray-500 text-xs mt-0.5 leading-snug">
                      Pop the interaction screen automatically when a door knock is detected.
                      Turn off to get a "Log this door" pill instead — tap it to open.
                    </span>
                  </span>
                  <Toggle
                    id="pref-auto-open"
                    checked={prefs.autoOpenInteractionModal}
                    onChange={(v) => setPref('autoOpenInteractionModal', v)}
                  />
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* Home-screen callouts — toggle any individual nudge on or off. */}
        <section>
          <h2 className="text-gray-600 font-semibold text-sm mb-3 uppercase tracking-wide">Home Callouts</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4 text-purple-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-gray-800 font-semibold text-sm">Personalized nudges</p>
                <p className="text-gray-500 text-xs mt-0.5 leading-snug">
                  Toggle the prompts you see between Start Canvassing and your goal card.
                  Each one only shows when there's enough data to say something useful.
                </p>
              </div>
            </div>
            <div className="border-t mt-3 divide-y divide-gray-50">
              {CALLOUT_TOGGLES.map((row) => (
                <div key={row.key} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-gray-800 font-semibold text-sm">{row.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5 leading-snug">{row.description}</p>
                  </div>
                  <Toggle
                    id={`pref-${row.key}`}
                    checked={prefs[row.key] !== false}
                    onChange={(v) => setPref(row.key, v)}
                  />
                </div>
              ))}
            </div>
          </div>
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

// Source of truth for the Home Callouts toggle section. Keeping this
// in one array keeps label copy + pref keys colocated, and any future
// addition is a one-line change. Keys match DEFAULTS in lib/prefs.js.
const CALLOUT_TOGGLES = [
  { key: 'calloutHotHour',             label: 'Hot hour',             description: 'Your best hour of the day for closes. Shows late afternoon (4–6pm).' },
  { key: 'calloutRankMovement',        label: 'Rank movement',        description: 'Weekly leaderboard moves — up or down — vs. last week.' },
  { key: 'calloutDrySpellRecovery',    label: 'Dry-spell recovery',   description: 'When a slump shows up, reminds you how you\'ve bounced back before.' },
  { key: 'calloutPersonalBestClose',   label: 'Personal best close',  description: 'Your best-ever weekly close rate, and how this week stacks up.' },
  { key: 'calloutCloseRateDiagnostic', label: 'Close-rate check',     description: 'A heads-up if your week\'s close rate dips well below your 30-day average.' },
  { key: 'calloutLevelUpProximity',    label: 'Level-up within reach',description: 'Fires when you\'re one good session away from the next level.' },
  { key: 'calloutTeamPulse',           label: 'Team pulse',           description: 'A snapshot of your team\'s activity and your share of it today.' },
]

/**
 * Minimal iOS-style toggle. Controlled component — checked + onChange(bool).
 * Keeps the whole Preferences section self-contained (no dep on shadcn).
 */
function Toggle({ id, checked, onChange }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-300 ' +
        (checked ? 'bg-blue-600' : 'bg-gray-300')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ' +
          (checked ? 'translate-x-5' : 'translate-x-0.5')
        }
      />
    </button>
  )
}
