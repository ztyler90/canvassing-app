/**
 * CompleteCheckout — card-up-front gate for new orgs.
 *
 * Shown (via the App.jsx gate) when an org has billing_required = true but no
 * Stripe subscription yet. Existing/grandfathered orgs (billing_required =
 * false) never see this.
 *
 * Two modes:
 *   - Returning from Checkout (?checkout=success): poll refreshUser until the
 *     webhook stamps the subscription onto the org, then the gate releases.
 *   - Otherwise: owner picks plan + interval and is redirected to hosted
 *     Stripe Checkout. Non-owners are told to ask their owner.
 */
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CreditCard, Check, Loader, RefreshCw, LogOut, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { createCheckoutSession, signOut } from '../lib/supabase.js'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

// Display prices (per seat). Mirror the Stripe catalog.
const PRICES = {
  standard: { month: 25, year: 240 },
  pro:      { month: 50, year: 480 },
}

export default function CompleteCheckout() {
  const { user, refreshUser } = useAuth()
  const [params] = useSearchParams()
  const returning = params.get('checkout') === 'success'
  const canceled  = params.get('checkout') === 'cancel'

  const org     = user?.organization || {}
  const isOwner = user?.role === 'manager' && org.owner_user_id === user?.id

  const [plan, setPlan]         = useState(org.selected_plan === 'pro' ? 'pro' : 'standard')
  const [interval, setInterval] = useState('month')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)
  const [finalizing, setFinalizing] = useState(returning)

  // Poll for the subscription after returning from Checkout. The webhook is
  // usually near-instant, but give it a few tries before offering a manual
  // refresh. When the subscription lands, the App gate unmounts this screen.
  const triesRef = useRef(0)
  useEffect(() => {
    if (!returning) return
    let active = true
    const tick = async () => {
      if (!active) return
      triesRef.current += 1
      await refreshUser()
      if (!active) return
      if (triesRef.current >= 6) { setFinalizing(false); return }
      setTimeout(tick, 2500)
    }
    const t = setTimeout(tick, 1500)
    return () => { active = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returning])

  async function startCheckout() {
    setBusy(true); setErr(null)
    const { url, error } = await createCheckoutSession({ plan, interval })
    if (error || !url) {
      setErr(error?.message || 'Could not start checkout. Please try again.')
      setBusy(false)
      return
    }
    window.location.href = url
  }

  // ── Finalizing state (returned from Stripe) ──────────────────────────────
  if (finalizing) {
    return (
      <Shell>
        <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: '#E0E7FF' }}>
          <Loader className="w-7 h-7 animate-spin" style={{ color: BRAND_BLUE }} />
        </div>
        <h1 className="font-bold text-gray-900 text-lg">Finalizing your subscription…</h1>
        <p className="text-gray-600 text-sm mt-2">This only takes a moment. Hang tight.</p>
      </Shell>
    )
  }

  const price = PRICES[plan][interval]
  const unit  = interval === 'year' ? '/seat/yr' : '/seat/mo'

  return (
    <Shell>
      <div className="mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: '#E0E7FF' }}>
        <CreditCard className="w-7 h-7" style={{ color: BRAND_BLUE }} />
      </div>
      <h1 className="font-bold text-gray-900 text-lg">
        {isOwner ? 'Start your 14-day trial' : 'Almost there'}
      </h1>

      {isOwner ? (
        <>
          <p className="text-gray-600 text-sm mt-2 leading-relaxed">
            Add a card to start your <span className="font-semibold text-gray-800">14-day free trial</span> of
            KnockIQ. You won't be charged until the trial ends, and you can cancel anytime before then.
          </p>

          {canceled && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
              Checkout was canceled — no problem, you can finish whenever you're ready.
            </p>
          )}

          {/* Plan toggle */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {['standard', 'pro'].map((p) => (
              <button
                key={p}
                onClick={() => setPlan(p)}
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors ${plan === p ? 'text-white' : 'bg-white text-gray-600 border-gray-200'}`}
                style={plan === p ? { background: BRAND_BLUE, borderColor: BRAND_BLUE } : undefined}
              >
                {p === 'pro' ? 'Pro' : 'Standard'}
              </button>
            ))}
          </div>

          {/* Interval toggle */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={() => setInterval('month')}
              className={`py-2 rounded-xl text-sm font-semibold border-2 transition-colors ${interval === 'month' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval('year')}
              className={`py-2 rounded-xl text-sm font-semibold border-2 transition-colors relative ${interval === 'year' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'bg-white text-gray-600 border-gray-200'}`}
            >
              Annual
              <span className="absolute -top-2 -right-1 text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: BRAND_LIME }}>-20%</span>
            </button>
          </div>

          <div className="mt-4 flex items-baseline justify-center gap-1">
            <span className="text-3xl font-bold text-gray-900">${price}</span>
            <span className="text-sm text-gray-500">{unit}</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">Full Pro features during your trial · billed per seat after</p>

          {err && (
            <div className="mt-4 flex items-start gap-2 text-left bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-700">{err}</p>
            </div>
          )}

          <button
            onClick={startCheckout}
            disabled={busy}
            className="btn-brand w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 mt-4 disabled:opacity-60"
          >
            {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? 'Opening secure checkout…' : 'Continue to secure checkout'}
          </button>
          <p className="text-[11px] text-gray-400 mt-2">Payments are processed securely by Stripe.</p>
        </>
      ) : (
        <p className="text-gray-600 text-sm mt-2 leading-relaxed">
          Your team's account isn't active yet — the account owner needs to add billing to finish
          setting up <span className="font-semibold text-gray-800">{org.name || 'your team'}</span>.
          Check back once they've completed it.
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        {returning && (
          <button
            onClick={() => refreshUser()}
            className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-semibold flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Check again
          </button>
        )}
        <button
          onClick={signOut}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <div className="mb-6 flex flex-col items-center">
        <img src="/logo.png" alt="KnockIQ" className="h-16 w-auto object-contain" />
      </div>
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
        {children}
      </div>
      <p className="text-center text-xs text-gray-400 mt-6 max-w-xs">
        Questions? <a href="mailto:hello@knockiq.com" className="text-blue-500 hover:underline">hello@knockiq.com</a>
      </p>
    </div>
  )
}
