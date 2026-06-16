/**
 * Turnstile — Cloudflare's privacy-friendly CAPTCHA.
 *
 * Renders nothing and is a complete no-op unless VITE_TURNSTILE_SITE_KEY is
 * set, so the auth screens behave exactly as before in dev and until the key
 * is configured. When enabled, it renders the widget and calls onVerify(token)
 * on success. The token is single-use and must be passed to Supabase auth as
 * options.captchaToken (Supabase verifies it server-side using the secret key
 * you set under Authentication → Attack Protection).
 *
 * Native-app resilience: inside a Capacitor WebView the widget can fail to
 * load or render (script blocked, the custom `KnockIQ://localhost` origin not
 * accepted, flaky network on a phone in the field). When that happens we must
 * NOT silently leave the token empty — that strands the rep on a login screen
 * with an invisible challenge they can't complete. Instead we surface a clear
 * inline message with a Retry button, and notify the parent via onError so the
 * form can explain why Sign In is blocked. A watchdog timeout catches the
 * worst case: the script/widget that never calls back at all.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'

const SITE_KEY   = import.meta.env.VITE_TURNSTILE_SITE_KEY
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// How long to wait for the widget to render / solve before we assume it's
// broken in this WebView and show the manual retry path. Generous enough not
// to trip on a slow field connection, short enough not to feel hung.
const LOAD_TIMEOUT_MS = 12000

// Cloudflare Turnstile renders an iframe from challenges.cloudflare.com. Inside
// a native Capacitor WebView the page origin is a custom app scheme
// (KnockIQ://localhost), which Turnstile won't accept — the widget fails to
// load and HARD-BLOCKS login on the phone with a challenge the rep can't
// complete. The native app ships through the App Store (not a public bot-facing
// form), so we switch the captcha off on native and let the web keep it.
//
// IMPORTANT: Supabase Attack Protection also enforces the captcha server-side.
// For native sign-in to actually succeed, the Supabase "Enable Captcha
// protection" toggle must be OFF (otherwise Supabase rejects the token-less
// native login). See THIRD_PARTY_SETUP.md.
const IS_NATIVE = Capacitor.isNativePlatform()

// On native we report the captcha as disabled so the auth forms don't gate
// Sign In on a token that can never arrive, and the widget renders nothing.
export const captchaEnabled = !!SITE_KEY && !IS_NATIVE

let scriptPromise = null
function loadScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = resolve
    s.onerror = (e) => {
      // Null the cache so a Retry re-attempts the network load instead of
      // re-resolving this same rejected promise forever.
      scriptPromise = null
      reject(e)
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export default function Turnstile({ onVerify, onExpire, onError }) {
  const containerRef = useRef(null)
  const widgetIdRef  = useRef(null)
  const timerRef     = useRef(null)
  // 'loading' | 'ready' | 'failed'  — drives the inline UI.
  const [status, setStatus] = useState('loading')
  // Bumping this re-runs the effect to re-attempt a fresh render.
  const [attempt, setAttempt] = useState(0)

  const fail = useCallback(() => {
    setStatus('failed')
    onError?.()
  }, [onError])

  useEffect(() => {
    if (!SITE_KEY || IS_NATIVE) return
    let cancelled = false
    setStatus('loading')

    // Watchdog: if nothing resolves the challenge in time, assume the widget
    // is broken in this environment and expose the retry path.
    timerRef.current = setTimeout(() => {
      if (!cancelled && status !== 'ready') fail()
    }, LOAD_TIMEOUT_MS)

    const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) {
          if (!cancelled) fail()
          return
        }
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITE_KEY,
            callback: (token) => {
              clearTimer()
              setStatus('ready')
              onVerify?.(token)
            },
            'expired-callback': () => { setStatus('loading'); onExpire?.() },
            'error-callback': () => { clearTimer(); onExpire?.(); fail() },
          })
        } catch {
          clearTimer()
          fail()
        }
      })
      .catch(() => { clearTimer(); fail() })

    return () => {
      cancelled = true
      clearTimer()
      try {
        if (widgetIdRef.current != null && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current)
        }
      } catch { /* widget already gone */ }
      widgetIdRef.current = null
    }
    // Re-runs on Retry (attempt). `status` is intentionally not a dep — the
    // watchdog reads it via closure and we don't want it restarting the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const retry = () => {
    onExpire?.()        // discard any stale token in the parent
    setAttempt((n) => n + 1)
  }

  if (!SITE_KEY || IS_NATIVE) return null

  if (status === 'failed') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">Couldn't load the verification challenge.</p>
        <p className="mt-0.5 text-amber-700">Check your connection, then retry.</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 font-semibold text-amber-900 underline underline-offset-2"
        >
          Retry verification
        </button>
      </div>
    )
  }

  // 'loading' and 'ready' both render the container; Cloudflare paints into it.
  return <div ref={containerRef} className="flex justify-center min-h-[65px]" />
}
