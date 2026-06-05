import { useState } from 'react'
import { signInWithEmail } from '../lib/supabase.js'

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
function SignInForm({ onMessage }) {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    const { error: err } = await signInWithEmail(email.trim().toLowerCase(), password)
    if (err) { setLoading(false); setError(err.message) }
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
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

      <button type="submit" disabled={loading}
        className="btn-brand w-full py-4 rounded-xl font-semibold text-lg">
        {loading ? 'Signing in…' : 'Sign In →'}
      </button>
    </form>
  )
}

// ─── Root Login screen ────────────────────────────────────────────────────────
export default function Login() {
  const [message] = useState('')

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">

        <KnockIQLogo />

        {message && (
          <div className="w-full max-w-sm mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm">
            {message}
          </div>
        )}

        {/* Sign-in only. New accounts go through /signup, which provisions the
            org and collects a card via hosted Stripe Checkout. The old in-page
            Elements signup (and its publishable-key dependency) has been removed. */}
        <SignInForm />

        <p className="mt-6 text-sm text-gray-500">
          New to KnockIQ?{' '}
          <a href="/signup" className="font-semibold text-blue-600 hover:underline">Start your free trial →</a>
        </p>
      </div>

      <p className="text-center text-xs text-gray-400 pb-8 px-4">
        By signing in you agree to GPS tracking while canvassing.
      </p>
    </div>
  )
}
