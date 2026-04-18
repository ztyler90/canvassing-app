/**
 * wakeLock.js — keep the screen on while a canvassing session is active.
 *
 * Honest limitation note:
 *   A web browser CANNOT track GPS or run JavaScript when the phone is
 *   locked / the browser tab is backgrounded. iOS Safari and Android
 *   Chrome both suspend JS within seconds. The only real fix for true
 *   "phone-in-pocket" tracking is wrapping the app as a native iOS /
 *   Android app (e.g. via Capacitor).
 *
 * What this module *does* solve: the most common cause of dropped
 * tracking — the phone going to sleep on its own after 30 s. While the
 * Wake Lock is held, the screen stays on (browser tab in foreground),
 * so GPS keeps streaming.
 *
 * Usage:
 *   await acquireWakeLock()    // call when session starts
 *   releaseWakeLock()          // call when session ends
 *
 * The lock is auto-released when the tab is hidden; the visibilitychange
 * listener re-acquires it when the user returns. Browsers without Wake
 * Lock (older Safari) silently no-op — no errors.
 */

let sentinel = null
let visibilityHandler = null
let wantActive = false  // user-intent: do we want the lock right now?

export async function acquireWakeLock() {
  wantActive = true
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return false
  }
  try {
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => {
      // Browser released it (tab hidden, low battery, etc.) — clear ref
      // so visibilitychange can re-acquire cleanly.
      sentinel = null
    })

    if (!visibilityHandler) {
      visibilityHandler = async () => {
        if (!wantActive) return
        if (document.visibilityState === 'visible' && !sentinel) {
          try {
            sentinel = await navigator.wakeLock.request('screen')
          } catch { /* ignore */ }
        }
      }
      document.addEventListener('visibilitychange', visibilityHandler)
    }
    return true
  } catch (err) {
    console.warn('[WakeLock] Could not acquire screen lock:', err?.message || err)
    return false
  }
}

export function releaseWakeLock() {
  wantActive = false
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler)
    visibilityHandler = null
  }
  if (sentinel) {
    try { sentinel.release() } catch { /* ignore */ }
    sentinel = null
  }
}

export function isWakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}
