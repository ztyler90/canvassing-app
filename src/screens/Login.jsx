import { useState } from 'react'
import { signInWithEmail, sendPasswordReset } from '../lib/supabase.js'
import Turnstile, { captchaEnabled } from '../components/Turnstile.jsx'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

// ─── Logo ─────────────────────────────────────────────────────────────────────
// Wrapped in a plain <a href="/"> (NOT a React Router <Link>) so the click
// triggers a real browser navigation. Vercel's `{ src: "/", dest: "/welcome.html" }`
// rewrite then serves the marketing page. Using Link would bounce through
// the SPA router and WelcomeRedirect, which is one render cycle longer for
// no benefit — and would silently break if a future router change ever
// added a `/` route to the unauth tree. The plain anchor is the escape
// hatch a visitor needs to get back to the homepage from login/signup.
function KnockIQLogo() {
  return (
    <a
      href="/"
      className="mb-8 flex flex-col items-center cursor-pointer"
      aria-label="KnockIQ — back to homepage"
    >
      <img
        src="/logo.png"
        alt="KnockIQ"
        className="h-24 w-auto object-contain"
      />
      <p className="text-gray-400 text-sm mt-2">Smart Door-to-Door Canvassing</p>
    </a>
  )
}

// ─── Sign-In form ─────────────────────────────────────────────────────────────
function SignInForm({ onForgot }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaFailed, setCaptchaFailed] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    if (captchaEnabled && !captchaToken) {
      setError(captchaFailed
        ? 'Verification could not load. Tap "Retry verification" above, then sign in.'
        : 'Please complete the verification challenge.')
      return
    }
    setLoading(true)
    const { error: err } = await signInWithEmail(email.trim().toLowerCase(), password, { captchaToken })
    if (err) {
      setLoading(false)
      setError(err.message)
      setCaptchaToken('')   // Turnstile tokens are single-use — force a re-solve on retry
    }
    // onAuthStateChange in AuthContext fires SIGNED_IN → navigates automatically
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email" inputMode="email" autoComplete="email"
          placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
          autoFocus
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-gray-700">Password</label>
          {/* Hand the email already typed up to the reset form so the user
              doesn't have to re-enter it. */}
          <button
            type="button"
            onClick={() => onForgot?.(email.trim().toLowerCase())}
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password" placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base pr-12"
          />
          <button type="button" onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            {showPass ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>}

      {/* No-op unless VITE_TURNSTILE_SITE_KEY is configured. onError surfaces a
          retry path so a widget that fails to load in the iOS WebView doesn't
          strand the user with an invisible challenge. */}
      <Turnstile
        onVerify={(t) => { setCaptchaToken(t); setCaptchaFailed(false) }}
        onExpire={() => setCaptchaToken('')}
        onError={() => { setCaptchaToken(''); setCaptchaFailed(true) }}
      />

      <button type="submit" disabled={loading}
        className="btn-brand w-full py-4 rounded-xl font-semibold text-lg">
        {loading ? 'Signing in…' : 'Sign In →'}
      </button>
    </form>
  )
}

// ─── Forgot-password form ─────────────────────────────────────────────────────
// Inline view on the login screen. Calls sendPasswordReset, which emails a
// one-time recovery link that lands the user on /reset-password. Supabase
// returns no error for unknown addresses (anti-enumeration), so we show the
// same "check your inbox" confirmation regardless of whether the email exists.
function ForgotPasswordForm({ initialEmail = '', onBack }) {
  const [email, setEmail]     = useState(initialEmail)
  const [error, setError]     = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter the email address for your account.')
      return
    }
    setSending(true)
    try {
      const { error: err } = await sendPasswordReset(trimmed)
      // Only transport/rate-limit errors surface here — "unknown email"
      // intentionally does not, to avoid leaking which addresses exist.
      if (err) { setError(err.message || 'Could not send the link. Try again in a moment.'); return }
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Network error. Try again.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#DBEAFE' }}>
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="#1B4FCC" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Check your inbox</h1>
          <p className="text-sm text-gray-500">
            If an account exists for <span className="font-medium text-gray-700">{email.trim().toLowerCase()}</span>,
            we've emailed a link to reset your password. It expires in 1 hour.
          </p>
          <p className="text-xs text-gray-400">
            Don't see it? Check your spam folder, or wait a minute and try again.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full py-3 rounded-xl font-semibold text-sm border border-gray-300 text-gray-700 bg-white"
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div className="text-center mb-2">
        <h1 className="text-xl font-bold text-gray-900">Reset your password</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enter your account email and we'll send you a link to choose a new password.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
          placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
          autoFocus
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>}

      <button type="submit" disabled={sending || !email.trim()}
        className="btn-brand w-full py-4 rounded-xl font-semibold text-lg disabled:opacity-60">
        {sending ? 'Sending…' : 'Send reset link →'}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full py-3 rounded-xl font-semibold text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to sign in
      </button>
    </form>
  )
}

// ─── Root Login screen ────────────────────────────────────────────────────────
export default function Login() {
  // 'signin' | 'forgot' — a plain in-screen toggle (no route change) so the
  // forgot-password flow feels like a continuation of the same page.
  const [mode, setMode]               = useState('signin')
  const [forgotEmail, setForgotEmail] = useState('')

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">

        <KnockIQLogo />

        {mode === 'forgot' ? (
          <ForgotPasswordForm
            initialEmail={forgotEmail}
            onBack={() => setMode('signin')}
          />
        ) : (
          <>
            {/* Sign-in only. New accounts go through /signup, which provisions the
                org and collects a card via hosted Stripe Checkout. The old in-page
                Elements signup (and its publishable-key dependency) has been removed. */}
            <SignInForm
              onForgot={(email) => { setForgotEmail(email); setMode('forgot') }}
            />

            <p className="mt-6 text-sm text-gray-500">
              New to KnockIQ?{' '}
              <a href="/signup" className="font-semibold text-blue-600 hover:underline">Start your free trial →</a>
            </p>
          </>
        )}
      </div>

      <p className="text-center text-xs text-gray-400 pb-8 px-4">
        By signing in you agree to GPS tracking while canvassing.
      </p>
    </div>
  )
}
