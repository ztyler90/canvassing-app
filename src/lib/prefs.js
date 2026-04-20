/**
 * Client-side rep preferences.
 *
 * Stored in localStorage (device-local, not synced across devices). This
 * keeps prefs instant to read/write with no Supabase round-trip, which
 * matters because some of these are checked on every GPS tick.
 *
 * Schema version in the key lets us migrate later without collisions.
 */
import { useEffect, useState } from 'react'

const PREFS_KEY = 'knockiq:rep-prefs-v1'

const DEFAULTS = {
  // When true (default), detecting a door knock auto-opens the
  // InteractionModal. When false, a non-modal "Log this door" pill
  // appears instead — the rep taps it to open the modal.
  autoOpenInteractionModal: true,

  // Home-screen callouts. Each one can be individually toggled by the
  // rep in Profile → Home Callouts. Defaults ON — a rep has to explicitly
  // opt out of a particular nudge. Every card also self-hides when its
  // underlying data can't credibly fill it, so these toggles only matter
  // for reps who have enough data to see them and explicitly don't want to.
  calloutHotHour:              true,
  calloutRankMovement:         true,
  calloutDrySpellRecovery:     true,
  calloutPersonalBestClose:    true,
  calloutCloseRateDiagnostic:  true,
  calloutLevelUpProximity:     true,
  calloutTeamPulse:            true,
}

// ── Internals ────────────────────────────────────────────────────

function read() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULTS }
    }
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...(parsed || {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

function write(prefs) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    // `storage` event only fires cross-tab — dispatch our own event so
    // usePrefs() hooks in the same tab also re-render immediately.
    window.dispatchEvent(new CustomEvent('knockiq:prefs-changed', { detail: prefs }))
  } catch {
    // Storage full or blocked (private mode) — silently ignore; the
    // runtime defaults will be used for this session.
  }
}

// ── Public API ───────────────────────────────────────────────────

/** Snapshot of current prefs. Always returns a full object (defaults-filled). */
export function getPrefs() {
  return read()
}

/** Update a single pref and return the new full prefs object. */
export function setPref(key, value) {
  const next = { ...read(), [key]: value }
  write(next)
  return next
}

/**
 * React hook — returns current prefs and re-renders whenever they
 * change (in this tab or another).
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState(read)

  useEffect(() => {
    const onChange  = () => setPrefs(read())
    const onStorage = (e) => { if (e.key === PREFS_KEY) onChange() }
    window.addEventListener('knockiq:prefs-changed', onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('knockiq:prefs-changed', onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return prefs
}
