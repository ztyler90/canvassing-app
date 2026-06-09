/**
 * Activate — the prefetch-proof landing page for invite/onboarding emails.
 *
 * Email-client link prefetch (Gmail iOS, Apple Mail Privacy Protection,
 * corporate spam scanners) consumes Supabase one-time magic-link tokens
 * BEFORE the human can click them. So we don't put Supabase tokens in
 * emails anymore — we put a link to this page.
 *
 * Flow:
 *   1. Email contains  https://app.getknockiq.com/activate?h=<handoff_token>
 *   2. Rep taps the link → lands here. Pre-fetchers can hit this page
 *      all they want; we don't touch auth state on render.
 *   3. We call the invite-handoff edge function's GET (peek) just to
 *      personalize the page with the rep's name + org. This is
 *      read-only — no tokens minted, no state mutated.
 *   4. Rep taps "Activate my account" → POST to invite-handoff which
 *      mints a FRESH Supabase magic link right now and returns its
 *      action_link.
 *   5. We window.location.href = action_link → Supabase verifies →
 *      drops the rep on /set-password with a session established.
 *
 * The Supabase verify token lives for only the ~1 second between
 * mint and consumption. Pre-fetchers have nothing to consume because
 * the only Supabase URL involved is created on-demand at click time.
 */
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, MapPin, ShieldAlert } from 'lucide-react'

const BRAND_BLUE = '#1B4FCC'
const BRAND_LIME = '#7DC31E'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const HANDOFF_URL   = `${SUPABASE_URL}/functions/v1/invite-handoff`

export default function Activate() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  // Token is the only auth credential. Everything else is presentational.
  // `n` is a name hint we put into the URL at email-send time so the
  // page can render a personalized header instantly, before the peek
  // call returns. Peek's full_name still overrides it once it lands.
  const handoffToken = params.get('h') || ''
  const nameHint     = params.get('n') || ''

  // 'peeking'  → looking up the handoff to personalize the page
  // 'ready'    → showing the big activate button
  // 'minting'  → button tapped, asking the server for a fresh magic link
  // 'error'    → bad/expired/used handoff or network failure
  const [stage, setStage]     = useState('peeking')
  const [info,  setInfo]      = useState(null)   // { full_name, org_name, inviter_name }
  const [error, setError]     = useState('')

  // Peek on mount so the page knows whose name to render. We
  // tolerate failures gracefully — the activate button still works
  // off the raw handoff_token even if peek errored.
  useEffect(() => {
    let cancelled = false
    if (!handoffToken) {
      setStage('error')
      setError('This page needs an invite link. Check your email and tap the link your manager sent.')
      return
    }
    ;(async () => {
      try {
        const r = await fetch(`${HANDOFF_URL}?h=${encodeURIComponent(handoffToken)}`, {
          method:  'GET',
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        })
        const body = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setStage('error')
          setError(body.message || 'This invite link is no longer valid. Ask your manager to send a new one.')
          return
        }
        if (body.completed) {
          setStage('error')
          setError('You’ve already finished setting up this account. Tap Sign in below to continue.')
          return
        }
        if (body.expired) {
          setStage('error')
          setError('This invite expired. Ask your manager to send a fresh one.')
          return
        }
        if (body.exhausted) {
          setStage('error')
          setError('This invite has been used too many times. Ask your manager to send a fresh one.')
          return
        }
        setInfo({
          full_name:    body.full_name    || nameHint || '',
          org_name:     body.org_name     || '',
          inviter_name: body.inviter_name || '',
        })
        setStage('ready')
      } catch (err) {
        if (cancelled) return
        // Network down or function offline — let them still tap the
        // button. The redeem POST will surface a clearer error if
        // it's a permanent failure.
        setInfo({ full_name: nameHint, org_name: '', inviter_name: '' })
        setStage('ready')
      }
    })()
    return () => { cancelled = true }
  }, [handoffToken, nameHint])

  async function handleActivate() {
    setStage('minting')
    setError('')
    try {
      const r = await fetch(HANDOFF_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          apikey:          SUPABASE_ANON,
          Authorization:   `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify({ handoff_token: handoffToken }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok || !body.action_link) {
        setStage('error')
        setError(body.message || 'Could not activate your account. Try again or ask your manager to resend.')
        return
      }
      // Hand off to Supabase. The verify URL fires now, gets exchanged
      // for a session, and drops us on /set-password.
      window.location.replace(body.action_link)
    } catch (err) {
      setStage('error')
      setError('Network error. Check your connection and try again.')
    }
  }

  const firstName = (info?.full_name || nameHint || '').trim().split(' ')[0]

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-12 pb-6">
        <Logo />

        {stage === 'peeking' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND_BLUE }} />
            <p className="text-gray-500 text-sm">Loading your invite&hellip;</p>
          </div>
        )}

        {stage === 'ready' && (
          <div className="w-full max-w-sm space-y-5 text-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {firstName ? `Welcome, ${firstName}!` : 'Welcome to KnockIQ'}
              </h1>
              <p className="text-sm text-gray-500 mt-2">
                {info?.org_name && info?.inviter_name
                  ? `${info.inviter_name} added you to ${info.org_name}.`
                  : info?.org_name
                    ? `You've been added to ${info.org_name}.`
                    : 'Your manager added you to the team.'}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Tap below to activate your account and set your password.
              </p>
            </div>

            <button
              type="button"
              onClick={handleActivate}
              className="w-full py-4 rounded-xl font-bold text-lg text-white shadow-md active:shadow-sm"
              style={{ backgroundColor: BRAND_BLUE }}
            >
              Activate my account
            </button>

            <p className="text-[11px] text-gray-400 leading-snug">
              By activating, you agree to KnockIQ’s terms of service. Your link is valid for 7 days.
            </p>
          </div>
        )}

        {stage === 'minting' && (
          <div className="w-full max-w-sm flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: BRAND_BLUE }} />
            <p className="text-gray-500 text-sm">Signing you in&hellip;</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm flex gap-3">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-1">Can't activate that link</p>
                <p>{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full py-4 rounded-xl font-semibold text-lg text-white"
              style={{ backgroundColor: BRAND_BLUE }}
            >
              Go to Sign In
            </button>
          </div>
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
