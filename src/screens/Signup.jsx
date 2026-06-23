import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { signUpWithEmail, signInWithEmail, provisionNewOrganization, sendWelcomeEmail, applyGrowthReferral } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import Turnstile, { captchaEnabled } from '../components/Turnstile.jsx'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

// App Store Guideline 4 + 3.1.1: on native iOS the bundle behaves as a pure
// client of an already-purchased B2B service. The signup screen does not link
// out to a paid web flow; team owners create accounts on getknockiq.com on
// a separate device, then sign into the app with those credentials. Web build
// (managers and prospects on desktop) keeps the full in-page signup form.

// ─── Logo ─────────────────────────────────────────────────────────────────────
// Plain <a href="/"> (not React Router <Link>) — clicking it forces a real
// browser navigation back to the homepage, which Vercel rewrites to
// /welcome.html. This is the visitor's escape hatch from the signup page
// if they landed here by mistake. Using a SPA Link would route through
// WelcomeRedirect which works but adds a render cycle.
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
      <p className="text-gray-400 text-sm mt-2">Start your 14-day free trial</p>
    </a>
  )
}

export default function Signup() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [searchParams] = useSearchParams()

  // ── Native-app gate ───────────────────────────────────────────────────────
  // Apple Guideline 4 (round 3 of the App Store appeal) classified our earlier
  // "open Safari to sign up" CTA as poor UX. Their preferred treatment for a
  // B2B SaaS like KnockIQ — where the buyer is a business owner who pays
  // outside the app and team members just authenticate — is that the iOS
  // bundle behaves as a pure client of an already-purchased service: no
  // mention of plans, pricing, billing, or external account creation. So on
  // native we now show an informational landing instead of any web link-out.
  // Team owners create their account on getknockiq.com (web) on a different
  // device; reps receive invites from their manager.
  if (Capacitor.isNativePlatform()) {
    return (
      <div className="min-h-screen flex flex-col bg-white">
        <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
          <KnockIQLogo />
          <div className="w-full max-w-sm space-y-5 text-center">
            <h1 className="text-xl font-bold text-gray-900">
              Welcome to KnockIQ
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              KnockIQ accounts are set up by your team's owner. If you've been
              invited to your team, sign in below with your invite credentials.
              If you're a business owner setting up a new account, ask your
              team administrator for an invitation.
            </p>
            <Link
              to="/login"
              className="btn-brand inline-block w-full py-4 rounded-xl font-semibold text-base"
            >
              Sign in
            </Link>
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 pb-8 px-4">
          Need help? Reach us at hello@knockiq.com
        </p>
      </div>
    )
  }

  // Plan the visitor clicked on the pricing page ('standard' | 'pro'). Drives
  // the post-trial plan they'll be billed for; the trial itself is full Pro.
  const selectedPlan = searchParams.get('plan') === 'pro' ? 'pro' : 'standard'
  // Private beta discount: a ?promo=beta on the signup link pre-applies the
  // 50%-off-for-life coupon at checkout. Absent/anything else → no discount.
  const promo = searchParams.get('promo') || null
  // Growth referral tracking: ?ref=<code> credits the new org to that growth
  // manager; optional ?offer=<slug> applies their promotion (e.g. a longer
  // free trial). Both are validated server-side in growth_apply_referral.
  const refCode  = searchParams.get('ref')   || null
  const refOffer = searchParams.get('offer') || null

  const [businessName, setBusinessName] = useState('')
  const [fullName,     setFullName]     = useState('')
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPass,     setShowPass]     = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaFailed, setCaptchaFailed] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const bn = businessName.trim()
    const fn = fullName.trim()
    const em = email.trim().toLowerCase()

    if (!bn || !fn || !em || !password) { setError('Please fill in all fields.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (captchaEnabled && !captchaToken) {
      setError(captchaFailed
        ? 'Verification could not load. Tap "Retry verification" above, then try again.'
        : 'Please complete the verification challenge.')
      return
    }

    setLoading(true)

    // 1. Create the auth user (this also inserts a public.users row via the
    //    handle_new_user trigger). The captcha token is single-use; we spend it
    //    on this public signup call (the abuse-prone one) and reset on error.
    const { data: signUpData, error: signUpError } = await signUpWithEmail(em, password, fn, { captchaToken })
    if (signUpError) {
      setLoading(false)
      setError(signUpError.message || 'Signup failed.')
      setCaptchaToken('')
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
    const { error: provError } = await provisionNewOrganization(bn, selectedPlan)
    if (provError) {
      setLoading(false)
      setError('Account created, but we couldn\'t set up your business: ' + provError.message)
      return
    }

    // 3. Rebuild the session/profile with the new organization_id attached.
    //    We normally do an explicit re-sign-in for a clean fresh session, but
    //    when Turnstile is enabled the captcha token is single-use (already
    //    spent on signUp above), so a second signInWithEmail would fail the
    //    captcha check. In that case we keep the session signUp already
    //    returned and rely on refreshUser() below to rebuild the profile (it
    //    re-reads the org with no auth-endpoint call, so no token is needed).
    if (!captchaEnabled) {
      await signInWithEmail(em, password)
    }

    // 3a. Credit the growth referral + apply any offer. Server-validated and
    //     best-effort. Awaited (it's quick) so the org's trial_days_override is
    //     stamped BEFORE the checkout gate reads it — otherwise the longer
    //     trial wouldn't take effect. A bad/missing code is a silent no-op.
    if (refCode) { try { await applyGrowthReferral(refCode, refOffer) } catch { /* never block signup */ } }

    // 3b. Fire the branded welcome email. Best-effort and intentionally NOT
    //     awaited — a slow/failed email must never delay the redirect into
    //     the app. sendWelcomeEmail swallows its own errors.
    void sendWelcomeEmail()

    // 4. Hand off to the CompleteCheckout gate (shown automatically because the
    //    new org has billing_required = true and no subscription yet). That's
    //    the single, intentional "add a card to start your trial" screen where
    //    the owner confirms plan + interval and goes to hosted Stripe Checkout.
    //    We deliberately do NOT redirect to Checkout here — doing both made the
    //    gate flash for a moment before the redirect. Carry the beta promo (if
    //    any) so the gate can apply the discount at checkout.
    if (promo) { try { localStorage.setItem('kiq_signup_promo', promo) } catch {} }
    // Wait for the full profile (org + billing_required) to load BEFORE handing
    // off, so the app routes straight to the billing screen instead of flashing
    // the dashboard for a few seconds while the org finishes loading. The signup
    // page keeps showing its own "Creating your account…" state during this wait.
    await refreshUser()
    navigate('/', { replace: true })
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
              14-day free trial. Add a card to start — cancel anytime before you're billed.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">{error}</div>
          )}

          {/* No-op unless VITE_TURNSTILE_SITE_KEY is configured. */}
          <Turnstile
            onVerify={(t) => { setCaptchaToken(t); setCaptchaFailed(false) }}
            onExpire={() => setCaptchaToken('')}
            onError={() => { setCaptchaToken(''); setCaptchaFailed(true) }}
          />

          <button type="submit" disabled={loading}
            className="btn-brand w-full py-4 rounded-xl font-semibold text-lg">
            {loading ? 'Creating your account…' : 'Start free trial →'}
          </button>

          <p className="text-center text-sm text-gray-500 pt-2">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-gradient">
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
