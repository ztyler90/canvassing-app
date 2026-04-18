import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { signUpWithEmail, signInWithEmail, provisionNewOrganization } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

// ─── Logo ─────────────────────────────────────────────────────────────────────
function KnockIQLogo() {
  return (
    <div className="mb-8 flex flex-col items-center">
      <div className="flex items-center gap-3 mb-1">
        <svg viewBox="0 0 48 62" fill="none" className="w-14 h-14" xmlns="http://www.w3.org/2000/svg">
          <path d="M24 0C13.51 0 5 8.51 5 19c0 14.25 19 43 19 43S43 33.25 43 19C43 8.51 34.49 0 24 0z" fill={BRAND_LIME}/>
          <rect x="17" y="9" width="14" height="19" rx="2" fill="white" opacity="0.25"/>
          <rect x="17" y="9" width="14" height="19" rx="2" stroke="white" strokeWidth="1.5"/>
          <line x1="24" y1="9" x2="24" y2="28" stroke="white" strokeWidth="1" opacity="0.5"/>
          <circle cx="30" cy="18.5" r="1.5" fill="white"/>
        </svg>
        <div className="flex items-baseline">
          <span className="text-4xl font-extrabold tracking-tight" style={{ color: BRAND_BLUE }}>Knock</span>
          <span className="text-4xl font-extrabold tracking-tight" style={{ color: BRAND_LIME }}>IQ</span>
        </div>
      </div>
      <p className="text-gray-400 text-sm mt-2">Start your 30-day free trial</p>
    </div>
  )
}

export default function Signup() {
  const navigate = useNavigate()

  const [businessName, setBusinessName] = useState('')
  const [fullName,     setFullName]     = useState('')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const bn = businessName.trim()
    const fn = fullName.trim()
    const em = email.trim().toLowerCase()

    if (!bn || !fn || !em || !password) { setError('Please fill in all fields.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setLoading(true)

    // 1. Create the auth user (this also inserts a public.users row via the
    //    handle_new_user trigger).
    const { data: signUpData, error: signUpError } = await signUpWithEmail(em, password, fn)
    if (signUpError) {
      setLoading(false)
      setError(signUpError.message || 'Signup failed.')
      return
    }

    // Some Supabase configs don't auto-confirm email. If no session came back,
    // the user needs to confirm via email before continuing.
    if (!signUpData?.session) {
      setLoading(false)
      setError(
        'Almost there — check your inbox to confirm your email, then sign in to finish setup.',
      )
      return
    }

    // 2. Provision the organization (creates org + stamps user as owner).
    //    Runs as the just-authenticated user; the RPC is SECURITY DEFINER.
    const { error: provError } = await provisionNewOrganization(bn)
    if (provError) {
      setLoading(false)
      setError('Account created, but we couldn\'t set up your business: ' + provError.message)
      return
    }

    // 3. Explicit sign-in to force a fresh session + profile rebuild with the
    //    new organization_id attached. onAuthStateChange will then route us.
    await signInWithEmail(em, password)

    // AuthContext will see the new profile (role=manager, organization_id set)
    // and render the manager router, which redirects "*" to /manager.
    navigate('/manager', { replace: true })
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">

        <KnockIQLogo />

        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Business name</label>
            <input
              type="text" autoComplete="organization"
              placeholder="Acme Solar"
              value={businessName} onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input
              type="text" autoComplete="name"
              placeholder="Jane Smith"
              value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Work email</label>
            <input
              type="email" inputMode="email" autoComplete="email"
              placeholder="you@company.com"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} autoComplete="new-password"
                placeholder="Min. 6 characters"
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base pr-12"
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-blue-700">
              30-day free trial. No credit card required. Add reps and cancel anytime.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading}
            className="w-full py-4 rounded-xl text-white font-semibold text-lg disabled:opacity-60 transition-opacity"
            style={{ backgroundColor: BRAND_BLUE }}>
            {loading ? 'Creating your account…' : 'Start free trial →'}
          </button>

          <p className="text-center text-sm text-gray-500 pt-2">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold" style={{ color: BRAND_BLUE }}>
              Sign in
            </Link>
          </p>
        </form>
      </div>

      <p className="text-center text-xs text-gray-400 pb-8 px-4">
        By creating an account you agree to GPS tracking while canvassing.
      </p>
    </div>
  )
}
