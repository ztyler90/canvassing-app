import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

/**
 * SetPassword — landing page for rep invite links.
 *
 * Flow:
 *   1. Manager adds a rep in Settings.
 *   2. manage-team edge function calls supabase.auth.admin.generateLink({
 *      type: 'invite', redirectTo: `${APP_BASE_URL}/set-password` }).
 *   3. The Resend email includes that action_link. When the rep clicks it,
 *      GoTrue drops them on `/set-password#access_token=…&refresh_token=…`.
 *   4. The Supabase client is configured with `detectSessionInUrl: true`
 *      (see src/lib/supabase.js), so on mount it parses the hash and
 *      establishes a session. We just listen for that session to arrive.
 *   5. Once authenticated, the rep enters a password → updateUser({ password })
 *      → we navigate them to `/` which lands on RepHome (role='rep').
 *
 * Two things worth knowing:
 *   • This screen is mounted in BOTH the unauthenticated and the
 *     authenticated-rep route trees in App.jsx. That's intentional: the
 *     pre-auth tree shows the "Verifying invite…" spinner while GoTrue is
 *     still processing the hash, and after SIGNED_IN fires the auth tree
 *     picks up the render on the next pass.
 *   • We deliberately DON'T sign the user out if they already had a
 *     session — the invite link is a magic link, and by the time this
 *     component mounts they're already signed in as the invited rep.
 */
export default function SetPassword() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [stage, setStage]         = useState('verifying')   // 'verifying' | 'ready' | 'saving' | 'done' | 'error'
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [errorMsg, setErrorMsg]   = useState('')
  const [userEmail, setUserEmail] = useState('')

  // ── Wait for GoTrue to land the session from the URL hash ──────────────
  useEffect(() => {
    let cancelled = false

    // Some clicks land here with an error already in the URL — GoTrue
    // writes `?error=...&error_description=...` for expired or reused links.
    const params = new URLSearchParams(window.location.search)
    const hash   = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const urlErr = params.get('error_description') || hash.get('error_description') || params.get('error')
    if (urlErr) {
      setStage('error')
      setErrorMsg(decodeURIComponent(urlErr).replace(/\+/g, ' '))
      return
    }

    // Poll briefly for the session — detectSessionInUrl is async, and we
    // get here faster than GoTrue finishes parsing on slow devices.
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.user) {
        setUserEmail(session.user.email || '')
        setStage('ready')
        return true
      }
      return false
    }

    // First check is immediate; after that we listen for the SIGNED_IN event.
    checkSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_IN' && session?.user) {
        setUserEmail(session.user.email || '')
        setStage('ready')
      }
    })

    // Safety net: if nothing resolved in 8 seconds, fail loudly rather than
    // leaving the rep staring at a spinner.
    const timeout = setTimeout(() => {
      if (cancelled) return
      checkSession().then((ok) => {
        if (ok || cancelled) return
        setStage('error')
        setErrorMsg("We couldn't verify your invite link. It may have expired. Please ask your manager to send a new invite.")
      })
    }, 8000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setErrorMsg('Passwords don\u2019t match.')
      return
    }

    setStage('saving')
    const { data: updateData, error } = await supabase.auth.updateUser({ password })
    if (error) {
      setStage('ready')
      setErrorMsg(error.message || 'Could not save your password. Please try again.')
      return
    }

    // Clear the force-password-change flag if it was set by the
    // temp-password onboarding flow. Safe to run for invite-flow reps
    // too — the column defaults to false, so this is a no-op there.
    // If the update fails (transient RLS hiccup), don't block the rep;
    // the worst case is they hit /set-password once more on next login.
    const uid = updateData?.user?.id
    if (uid) {
      try {
        await supabase.from('users').update({ force_password_change: false }).eq('id', uid)
      } catch (e) {
        console.warn('[SetPassword] could not clear force_password_change:', e)
      }
    }

    // Re-sync AuthContext's profile *before* we navigate. Otherwise we
    // race the USER_UPDATED handler: it re-reads public.users and can
    // catch the stale `force_password_change: true` value (our clearing
    // update above runs milliseconds later), which makes App.jsx's
    // force-change gate bounce us right back to /set-password — the
    // visible "flicker" the rep sees on success.
    try { await refreshUser?.() } catch { /* non-fatal */ }

    // Give the rep a clear "saved" beat before the redirect so it
    // doesn't feel like the form silently vanished. AppRoutes will now
    // see force_password_change=false and land them on RepHome.
    setStage('done')
    setTimeout(() => navigate('/', { replace: true }), 900)
  }

  // ── Render branches ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
        <Logo />

        {stage === 'verifying' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 py-8">
            <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-blue-700 animate-spin" />
            <p className="text-gray-500 text-sm">Verifying your invite&hellip;</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">
              <p className="font-semibold mb-1">Invite link problem</p>
              <p>{errorMsg}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="btn-brand w-full py-4 rounded-xl font-semibold text-lg"
            >
              Go to Sign In
            </button>
          </div>
        )}

        {stage === 'done' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#DCFCE7' }}>
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-gray-900">Password saved</h1>
              <p className="text-sm text-gray-500 mt-1">Redirecting you to your dashboard&hellip;</p>
            </div>
          </div>
        )}

        {(stage === 'ready' || stage === 'saving') && (
          <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
            <div className="text-center mb-2">
              <h1 className="text-xl font-bold text-gray-900">Set your password</h1>
              {userEmail && (
                <p className="text-sm text-gray-500 mt-1">
                  Signing in as <span className="font-medium text-gray-700">{userEmail}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base pr-12"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
                >
                  {showPass ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                type={showPass ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Re-enter password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
              />
            </div>

            {errorMsg && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={stage === 'saving'}
              className="btn-brand w-full py-4 rounded-xl font-semibold text-lg"
            >
              {stage === 'saving' ? 'Saving\u2026' : 'Save & Continue \u2192'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Your password is stored securely. Your manager never sees it.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div className="mb-8 flex flex-col items-center">
      <img
        src="/logo.png"
        alt="KnockIQ"
        className="h-24 w-auto object-contain"
      />
      <p className="text-gray-400 text-sm mt-2">Welcome to the team</p>
    </div>
  )
}
