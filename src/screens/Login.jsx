import { useState } from 'react'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { signInWithEmail } from '../lib/supabase.js'
import { supabase } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

// Initialise Stripe — publishable key comes from env var
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

// ─── Card element appearance ──────────────────────────────────────────────────
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: '16px',
      color: '#111827',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      '::placeholder': { color: '#9ca3af' },
    },
    invalid: { color: '#dc2626' },
  },
  hidePostalCode: false,
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function KnockIQLogo() {
  return (
    <div className="mb-8 flex flex-col items-center">
      <img
        src="/logo.png"
        alt="KnockIQ"
        className="h-24 w-auto object-contain"
      />
      <p className="text-gray-400 text-sm mt-2">Smart Door-to-Door Canvassing</p>
    </div>
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

// ─── Sign-Up form (with Stripe card) ─────────────────────────────────────────
function SignUpFormInner({ onSuccess }) {
  const stripe   = useStripe()
  const elements = useElements()

  const [fullName, setFullName] = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [cardReady, setCardReady] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!fullName || !email || !password) { setError('Please fill in all fields.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (!stripe || !elements) { setError('Stripe is still loading — please try again.'); return }

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) { setError('Card field not found.'); return }

    setLoading(true)

    // 1. Tokenise card → PaymentMethod
    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
      type: 'card',
      card: cardElement,
      billing_details: { name: fullName, email: email.trim().toLowerCase() },
    })

    if (pmError) {
      setLoading(false)
      setError(pmError.message ?? 'Card error.')
      return
    }

    // 2. Call Supabase Edge Function — creates Stripe customer + subscription +
    //    Supabase auth user all in one atomic server-side operation.
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-subscription', {
        body: {
          email:             email.trim().toLowerCase(),
          password,
          full_name:         fullName.trim(),
          payment_method_id: paymentMethod.id,
        },
      })

      if (fnError || !data?.success) {
        setLoading(false)
        setError(data?.error ?? fnError?.message ?? 'Signup failed. Please try again.')
        return
      }

      // 3. Account + subscription created — sign in automatically
      const { error: signInError } = await signInWithEmail(email.trim().toLowerCase(), password)
      if (signInError) {
        // Account was created; direct them to sign in manually
        setLoading(false)
        onSuccess('Account created! Please sign in.')
        return
      }
      // onAuthStateChange in AuthContext will navigate to home

    } catch (err) {
      setLoading(false)
      setError('An unexpected error occurred. Please try again.')
      console.error('[SignUp]', err)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
        <input type="text" autoComplete="name" placeholder="Jane Smith"
          value={fullName} onChange={(e) => setFullName(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
          autoFocus />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <div className="relative">
          <input type={showPass ? 'text' : 'password'} autoComplete="new-password"
            placeholder="Min. 6 characters"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base pr-12" />
          <button type="button" onClick={() => setShowPass(!showPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            {showPass ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {/* Stripe card element */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Payment Card
          <span className="ml-2 text-xs font-normal text-gray-400">(charged after 7-day trial)</span>
        </label>
        <div className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus-within:border-blue-700 transition-colors bg-white">
          <CardElement
            options={CARD_ELEMENT_OPTIONS}
            onChange={(e) => {
              setCardReady(e.complete)
              if (e.error) setError(e.error.message)
              else if (error && error.includes('card')) setError('')
            }}
          />
        </div>
      </div>

      {/* Trial reminder */}
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
        <svg className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-blue-700">
          Your card won't be charged today. Your 7-day free trial starts now — billing begins on day 8.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>
      )}

      <button type="submit"
        disabled={loading || !stripe}
        className="btn-brand w-full py-4 rounded-xl font-semibold text-lg">
        {loading ? 'Setting up your account…' : 'Start Free Trial →'}
      </button>

      <p className="text-xs text-gray-400 text-center">
        New accounts are pending until a manager assigns your rep role.
      </p>
    </form>
  )
}

// ─── Root Login screen ────────────────────────────────────────────────────────
export default function Login() {
  const [mode, setMode]       = useState('signin')
  const [message, setMessage] = useState('')

  const handleModeChange = (m) => {
    setMode(m)
    setMessage('')
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">

        <KnockIQLogo />

        {/* Tab toggle */}
        <div className="flex w-full max-w-sm rounded-xl overflow-hidden border border-gray-200 mb-6">
          {['signin', 'signup'].map((m) => (
            <button key={m} type="button"
              onClick={() => handleModeChange(m)}
              className="flex-1 py-3 text-sm font-semibold transition-colors"
              style={mode === m
                ? { background: 'linear-gradient(135deg, #2E6BFF 0%, #1B4FCC 100%)', color: '#fff' }
                : { backgroundColor: '#f9fafb', color: '#6b7280' }}>
              {m === 'signin' ? 'Sign In' : 'Start Free Trial'}
            </button>
          ))}
        </div>

        {message && (
          <div className="w-full max-w-sm mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-700 text-sm">
            {message}
          </div>
        )}

        {mode === 'signin' ? (
          <SignInForm />
        ) : (
          <Elements stripe={stripePromise}>
            <SignUpFormInner onSuccess={(msg) => { setMessage(msg); setMode('signin') }} />
          </Elements>
        )}
      </div>

      <p className="text-center text-xs text-gray-400 pb-8 px-4">
        By signing in you agree to GPS tracking while canvassing.
      </p>
    </div>
  )
}
