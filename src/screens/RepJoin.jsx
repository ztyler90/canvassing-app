/**
 * RepJoin — rep self-sign-up via a shareable invite code.
 *
 * Mounted at /join/:code in App.jsx's unauthenticated route tree. The flow:
 *
 *   1. URL is opened (typically tapped from a text the owner sent).
 *   2. lookupInviteCode() resolves the code → org name preview, so the rep
 *      sees "You're joining Acme Solar" before typing anything.
 *      - Unknown / disabled code → friendly error + Cancel CTA.
 *   3. Rep fills name, email, phone (optional), password.
 *   4. Submit:
 *        a. supabase.auth.signUp({ email, password }) — same call the owner
 *           Signup screen uses, just without a business name.
 *        b. If no auto-confirm session comes back (the project hasn't set
 *           "Confirm email" off), prompt the rep to check their inbox. The
 *           code is still attached to their email; they can come back to
 *           this URL after confirming.
 *        c. With a session in hand, call consumeInviteCode() — RPC stamps
 *           public.users with the right organization_id and status='pending'.
 *        d. Force a fresh sign-in so the AuthContext rebuilds the profile
 *           (including the new organization + pending status) and routes
 *           the user to the /pending gate automatically.
 *
 * The component does NOT redirect on success — AppRoutes will see the
 * pending status from buildProfile and switch trees on its own. We just
 * navigate to '/' as a no-op so the URL bar isn't stuck on /join/<code>.
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Building2, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import {
  signUpWithEmail,
  signInWithEmail,
  lookupInviteCode,
  consumeInviteCode,
} from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'

function KnockIQLogo({ subtitle }) {
  return (
    <div className="mb-6 flex flex-col items-center">
      <img src="/logo.png" alt="KnockIQ" className="h-20 w-auto object-contain" />
      <p className="text-gray-400 text-sm mt-2">{subtitle}</p>
    </div>
  )
}

export default function RepJoin() {
  const { code: rawCode } = useParams()
  const code = (rawCode || '').toUpperCase()
  const navigate = useNavigate()

  // Code resolution lifecycle:
  //   'checking' — RPC in flight
  //   'valid'    — code resolved, render the join form
  //   'invalid'  — unknown / disabled, render the dead-link state
  const [codeState, setCodeState] = useState('checking')
  const [orgName,   setOrgName]   = useState('')

  // Form state
  const [fullName,    setFullName]    = useState('')
  const [email,       setEmail]       = useState('')
  const [phone,       setPhone]       = useState('')
  const [password,    setPassword]    = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState('')
  // Surfaced when the Supabase project keeps "Confirm email" on. In that
  // case signUp returns no session and the rep has to round-trip through
  // their inbox before we can finish attaching them to the org.
  const [confirmHint, setConfirmHint] = useState(false)

  // Validate the code on mount — single-fire effect; the code only changes
  // when the user navigates to a different /join URL, in which case the
  // route remounts.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!code) { setCodeState('invalid'); return }
      const result = await lookupInviteCode(code)
      if (cancelled) return
      if (!result) {
        setCodeState('invalid')
      } else {
        setOrgName(result.organizationName || 'this team')
        setCodeState('valid')
      }
    })()
    return () => { cancelled = true }
  }, [code])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setConfirmHint(false)

    const fn = fullName.trim()
    const em = email.trim().toLowerCase()
    const ph = phone.trim()

    if (!fn || !em || !password) {
      setError('Please fill in your name, email, and password.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSubmitting(true)

    // 1. Create the auth user. handle_new_user trigger inserts a stub row
    //    in public.users; consumeInviteCode (below) upserts on top of it.
    const { data: signUpData, error: signUpError } = await signUpWithEmail(em, password, fn)
    if (signUpError) {
      setSubmitting(false)
      // Friendly remap for the most common Supabase signup errors.
      const raw = signUpError.message || 'Sign-up failed.'
      const friendly =
        /already registered/i.test(raw)
          ? 'An account with that email already exists. Sign in instead.'
          : raw
      setError(friendly)
      return
    }

    // 2. If the project has email confirmation on, signUp returns user+null
    //    session. We can't attach to the org until we have a session (the
    //    consume RPC reads auth.uid()). Tell the rep what to do and stop.
    if (!signUpData?.session) {
      setSubmitting(false)
      setConfirmHint(true)
      return
    }

    // 3. Attach to the org. The RPC stamps role='rep' + status='pending'
    //    regardless of what the rep might have tried to send — there's
    //    no way to elevate to manager through this flow.
    const consume = await consumeInviteCode({ code, fullName: fn, phone: ph || null })
    if (consume.error) {
      setSubmitting(false)
      setError(consume.error.message || 'Could not attach your account to the team. Try again or contact your manager.')
      return
    }

    // 4. Re-sign-in so AuthContext rebuilds the profile from the freshly-
    //    written public.users row (organization, pending status, etc.).
    //    Without this, the existing session points at the pre-consume
    //    profile and the /pending gate doesn't engage until next reload.
    await signInWithEmail(em, password)

    // AppRoutes will route to /pending once the new profile lands. Send
    // them to '/' as a clean landing so the URL bar isn't stuck on /join.
    navigate('/', { replace: true })
  }

  // ── Render states ─────────────────────────────────────────────────────
  if (codeState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-6 h-6 animate-spin text-blue-600" />
          <p className="text-gray-500 text-sm">Checking your invite link…</p>
        </div>
      </div>
    )
  }

  if (codeState === 'invalid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
        <KnockIQLogo subtitle="Invite link" />
        <div className="w-full max-w-sm bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
          <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="font-semibold text-red-800">This link isn't active.</p>
          <p className="text-sm text-red-700 mt-1">
            The owner may have disabled it or generated a new one. Ask them to send you a fresh link.
          </p>
        </div>
        <Link to="/login" className="mt-6 text-sm text-blue-600 font-semibold">
          Already have an account? Sign in →
        </Link>
      </div>
    )
  }

  // Email-confirm interstitial — shown when the Supabase project has
  // "Confirm email" enabled and no session came back from signUp.
  if (confirmHint) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
        <KnockIQLogo subtitle={`Joining ${orgName}`} />
        <div className="w-full max-w-sm bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center">
          <CheckCircle className="w-8 h-8 text-blue-600 mx-auto mb-2" />
          <p className="font-semibold text-blue-900">Almost there — check your email.</p>
          <p className="text-sm text-blue-800 mt-2 leading-relaxed">
            We sent a confirmation link to <strong>{email}</strong>. Tap it, then come back to{' '}
            <Link to="/login" className="underline font-semibold">sign in</Link>. Your manager
            will approve your account after that.
          </p>
        </div>
      </div>
    )
  }

  // ── Main form ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
        <KnockIQLogo subtitle="Join your team" />

        {/* Org confirmation chip — gives the rep an instant "yes, this is
            the right link" before they fill out anything. */}
        <div
          className="mb-5 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
          style={{ backgroundColor: '#E0E7FF', color: BRAND_BLUE }}
        >
          <Building2 className="w-4 h-4" />
          You're joining {orgName}
        </div>

        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your name</label>
            <input
              type="text" autoComplete="name"
              placeholder="Jane Smith"
              value={fullName} onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-700 focus:outline-none text-base"
              autoFocus
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="tel" inputMode="tel" autoComplete="tel"
              placeholder="+1 555 123 4567"
              value={phone} onChange={(e) => setPhone(e.target.value)}
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
              <button
                type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
            </svg>
            <p className="text-xs text-amber-800">
              After you sign up, your manager will see your account in their approval queue.
              You'll be able to log in once they approve.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit" disabled={submitting}
            className="btn-brand w-full py-4 rounded-xl font-semibold text-lg"
          >
            {submitting ? 'Creating your account…' : `Join ${orgName} →`}
          </button>

          <p className="text-center text-sm text-gray-500 pt-2">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-gradient">Sign in</Link>
          </p>
        </form>
      </div>

      <p className="text-center text-xs text-gray-400 pb-8 px-4">
        By creating an account you agree to GPS tracking while canvassing.
      </p>
    </div>
  )
}
