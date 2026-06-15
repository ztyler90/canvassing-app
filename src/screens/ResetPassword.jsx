import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, sendPasswordReset } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const BRAND_BLUE = '#1B4FCC'

/**
 * ResetPassword — landing page for "forgot password" recovery links.
 *
 * Flow:
 *   1. On the login screen the user taps "Forgot password?", enters their
 *      email, and we call sendPasswordReset() → supabase.auth
 *      .resetPasswordForEmail({ redirectTo: `${origin}/reset-password` }).
 *   2. GoTrue emails the branded recovery template (supabase/templates/
 *      recovery.html). The {{ .ConfirmationURL }} verifies the one-time
 *      token and redirects the user to
 *      `/reset-password#access_token=…&refresh_token=…&type=recovery`.
 *   3. The Supabase client is configured with `detectSessionInUrl: true`
 *      (see src/lib/supabase.js), so on mount it parses the hash, establishes
 *      a (recovery-scoped) session, and fires PASSWORD_RECOVERY / SIGNED_IN.
 *      We listen for that session to arrive.
 *   4. Once authenticated, the user enters a new password →
 *      updateUser({ password }) → we navigate them to `/`, where AppRoutes
 *      lands them on the right home screen for their role.
 *
 * Why this screen instead of redirecting to "/":
 *   The recovery link authenticates the user. If we sent them straight to
 *   "/" they'd be silently signed in and never get the chance to choose a
 *   new password — which is the entire point of a reset. This screen is the
 *   missing "choose a new password" step.
 *
 * Routing note: because the recovery link makes the user authenticated,
 * App.jsx intercepts `/reset-password` ABOVE the role/billing/pending gates
 * so this screen always renders regardless of the user's account state.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()

  const [stage, setStage]         = useState('verifying')   // 'verifying' | 'ready' | 'saving' | 'done' | 'error'
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [errorMsg, setErrorMsg]   = useState('')
  const [userEmail, setUserEmail] = useState('')

  // Recovery path for the "reset link expired/consumed" case. The most
  // common cause we see in production is email-client link prefetch
  // (Gmail iOS, Apple Mail Privacy Protection, corp spam filters) GETting
  // the verify URL before the human can tap it, which consumes the
  // one-time token. Giving the user a self-service "send me a fresh link"
  // path here means they don't have to go back to the login screen.
  const [recoverEmail,   setRecoverEmail]   = useState('')
  const [recoverSending, setRecoverSending] = useState(false)
  const [recoverResult,  setRecoverResult]  = useState(null) // { ok: boolean, message: string }

  // ── Wait for GoTrue to land the recovery session from the URL hash ──────
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
    // can get here faster than GoTrue finishes parsing on slow devices.
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return false
      if (session?.user) {
        setUserEmail(session.user.email || '')
        setStage('ready')
        return true
      }
      return false
    }

    // First check is immediate; after that we listen for the auth event.
    // PASSWORD_RECOVERY is what GoTrue fires for a recovery link, but we
    // also accept SIGNED_IN as a belt-and-suspenders for client versions
    // that surface the recovery session under the generic event.
    checkSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session?.user) {
        setUserEmail(session.user.email || '')
        setStage('ready')
      }
    })

    // Safety net: if nothing resolved in 8 seconds, fail loudly rather than
    // leaving the user staring at a spinner.
    const timeout = setTimeout(() => {
      if (cancelled) return
      checkSession().then((ok) => {
        if (ok || cancelled) return
        setStage('error')
        setErrorMsg("We couldn't verify your reset link. It may have expired or already been used. Request a fresh one below.")
      })
    }, 8000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  // Re-trigger a reset email to the address the user enters. Reuses the
  // same sendPasswordReset() helper as the login screen so there's one
  // code path for "email me a recovery link." Supabase returns no error
  // for unknown emails (anti-enumeration), so we always show the same
  // "check your inbox" confirmation.
  const handleResendLink = async (e) => {
    e?.preventDefault?.()
    setRecoverResult(null)
    const email = recoverEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      setRecoverResult({ ok: false, message: 'Enter the email for your account.' })
      return
    }
    setRecoverSending(true)
    try {
      const { error } = await sendPasswordReset(email)
      if (error) {
        setRecoverResult({ ok: false, message: error.message || 'Could not send the link. Try again in a moment.' })
      } else {
        setRecoverResult({
          ok: true,
          message: `Sent. Check ${email} (and the spam folder) for a fresh reset link.`,
        })
      }
    } catch (err) {
      setRecoverResult({ ok: false, message: err?.message || 'Network error. Try again.' })
    } finally {
      setRecoverSending(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setErrorMsg('Passwords don’t match.')
      return
    }

    setStage('saving')
    const { data: updateData, error } = await supabase.auth.updateUser({ password })
    if (error) {
      setStage('ready')
      setErrorMsg(error.message || 'Could not save your password. Please try again.')
      return
    }

    // Clear the force-password-change flag if it happened to be set (e.g. a
    // temp-password rep who reset via this flow instead of /set-password).
    // Safe to run for everyone — the column defaults to false, so it's a
    // no-op for normal resets. Never block on a transient failure here.
    const uid = updateData?.user?.id
    if (uid) {
      try {
        await supabase.from('users').update({ force_password_change: false }).eq('id', uid)
      } catch (err) {
        console.warn('[ResetPassword] could not clear force_password_change:', err)
      }
    }

    // Re-sync AuthContext's profile before navigating so App.jsx's gates
    // (force_password_change in particular) see the fresh values and don't
    // bounce the user on the first post-reset render.
    try { await refreshUser?.() } catch { /* non-fatal */ }

    // Give a clear "saved" beat before the redirect so it doesn't feel like
    // the form silently vanished.
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
            <p className="text-gray-500 text-sm">Verifying your reset link&hellip;</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">
              <p className="font-semibold mb-1">Reset link problem</p>
              <p>{errorMsg}</p>
            </div>

            {/* Self-service recovery. Most "expired" errors here are caused
                by email-client link prefetch consuming the one-time token
                before the user's tap — a fresh link generally clears it. */}
            <form onSubmit={handleResendLink} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Send me a fresh reset link</p>
                <p className="text-xs text-gray-500 mt-0.5">We'll email a new one-time link to your inbox.</p>
              </div>
              <input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoComplete="email"
                placeholder="your@email.com"
                value={recoverEmail}
                onChange={(e) => setRecoverEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
              />
              {recoverResult && (
                <div className={`text-xs rounded-lg px-3 py-2 ${
                  recoverResult.ok
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                  {recoverResult.message}
                </div>
              )}
              <button
                type="submit"
                disabled={recoverSending || !recoverEmail.trim()}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
                style={{ backgroundColor: BRAND_BLUE }}
              >
                {recoverSending ? 'Sending…' : 'Email me a link'}
              </button>
              <p className="text-[11px] text-gray-400 leading-snug">
                Tip: open this email in a browser instead of tapping inside a mail app. Some inboxes pre-scan links and consume them before you can.
              </p>
            </form>

            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full py-3 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700 bg-white"
            >
              Back to sign in
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
              <h1 className="text-xl font-bold text-gray-900">Password updated</h1>
              <p className="text-sm text-gray-500 mt-1">Redirecting you to your dashboard&hellip;</p>
            </div>
          </div>
        )}

        {(stage === 'ready' || stage === 'saving') && (
          <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
            <div className="text-center mb-2">
              <h1 className="text-xl font-bold text-gray-900">Choose a new password</h1>
              {userEmail && (
                <p className="text-sm text-gray-500 mt-1">
                  for <span className="font-medium text-gray-700">{userEmail}</span>
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
              {stage === 'saving' ? 'Saving…' : 'Update password →'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Your password is stored securely. Your team never sees it.
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
      <p className="text-gray-400 text-sm mt-2">Reset your password</p>
    </div>
  )
}
