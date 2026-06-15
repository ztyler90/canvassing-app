/**
 * Turnstile — Cloudflare's privacy-friendly CAPTCHA.
 *
 * Renders nothing and is a complete no-op unless VITE_TURNSTILE_SITE_KEY is
 * set, so the auth screens behave exactly as before in dev and until the key
 * is configured. When enabled, it renders the widget and calls onVerify(token)
 * on success. The token is single-use and must be passed to Supabase auth as
 * options.captchaToken (Supabase verifies it server-side using the secret key
 * you set under Authentication → Attack Protection).
 */
import { useEffect, useRef, useState } from 'react'

const SITE_KEY   = import.meta.env.VITE_TURNSTILE_SITE_KEY
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export const captchaEnabled = !!SITE_KEY

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
    s.onerror = reject
    document.head.appendChild(s)
  })
  return scriptPromise
}

export default function Turnstile({ onVerify, onExpire }) {
  const containerRef = useRef(null)
  const widgetIdRef  = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onVerify?.(token),
          'expired-callback': () => onExpire?.(),
          'error-callback': () => onExpire?.(),
        })
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      try {
        if (widgetIdRef.current != null && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current)
        }
      } catch { /* widget already gone */ }
    }
  }, [])

  if (!SITE_KEY || failed) return null
  return <div ref={containerRef} className="flex justify-center" />
}
