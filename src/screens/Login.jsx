import { useState } from 'react'
import { signInWithEmail, signUpWithEmail } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'

const BRAND_GREEN = '#1A6B3A'

export default function Login() {
  const { refreshUser } = useAuth()
  const [mode, setMode]         = useState('signin')   // 'signin' | 'signup'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleSignIn = async (e) => {
    e.preventDefault()
    setError(''); setMessage('')
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    const { error: err } = await signInWithEmail(email.trim().toLowerCase(), password)
    setLoading(false)
    if (err) { setError(err.message); return }
    await refreshUser()
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    setError(''); setMessage('')
    if (!fullName || !email || !password) { setError('Please fill in all fields.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    const { error: err } = await signUpWithEmail(email.trim().toLowerCase(), password, fullName.trim())
    setLoading(false)
    if (err) { setError(err.message); return }
    setMessage('Account created! You can now sign in.')
    setMode('signin')
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">

        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Shack Shine</h1>
          <p className="text-gray-500 text-sm mt-1">Field Canvassing App</p>
        </div>

        {/* Tab toggle */}
        <div className="flex w-full max-w-sm rounded-xl overflow-hidden border border-gray-200 mb-6">
          {['signin', 'signup'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(''); setMessage('') }}
              className="flex-1 py-3 text-sm font-semibold transition-colors"
              style={mode === m
                ? { backgroundColor: BRAND_GREEN, color: '#fff' }
                : { backgroundColor: '#f9fafb', color: '#6b7280' }}
            >
              {m === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className="w-full max-w-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-700 focus:outline-none text-base"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-700 focus:outline-none text-base pr-12"
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

            {error   && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>}
            {message && <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm">{message}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl text-white font-semibold text-lg disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              {loading ? 'Signing in…' : 'Sign In →'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignUp} className="w-full max-w-sm space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                autoComplete="name"
                placeholder="Jane Smith"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-700 focus:outline-none text-base"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-700 focus:outline-none text-base"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-700 focus:outline-none text-base pr-12"
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

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl text-white font-semibold text-lg disabled:opacity-60 transition-opacity"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              {loading ? 'Creating account…' : 'Create Account →'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Accounts created here are pending — a manager must assign your rep role before you can start canvassing.
            </p>
          </form>
        )}
      </div>

      <p className="text-center text-xs text-gray-400 pb-8 px-4">
        By signing in you agree to GPS tracking while canvassing.
      </p>
    </div>
  )
}
