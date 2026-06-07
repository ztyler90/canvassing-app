/**
 * Client-side rep preferences.
 *
 * Stored in localStorage (device-local, not synced across devices). This
 * keeps prefs instant to read/write with no Supabase round-trip, which
 * matters because some of these are checked on every render.
 *
 * Schema version in the key lets us migrate later without collisions.
 *
 * Home callouts used to be individually toggled on/off from Profile. That
 * surface was removed for basic reps: instead, each callout card carries a
 * dismiss "✕" and the rep closes the ones they don't want. Dismissals are
 * remembered here so a closed card stays closed across reloads (until the
 * rep resets, or — for ephemeral cards — until that specific instance
 * changes; see how RepCallouts builds dismiss keys).
 */
import { useEffect, useState } from 'react'

// Bumped v1 → v2 when the callout model changed from per-card toggles to
// per-card dismissals. Old v1 toggle blobs are simply ignored.
const PREFS_KEY = 'knockiq:rep-prefs-v2'

const DEFAULTS = {
  // Map of callout dismiss-key → true. A key present here means the rep has
  // closed that callout and it should stay hidden. Absent/false = visible.
  dismissedCallouts: {},
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
    return {
      ...DEFAULTS,
      ...(parsed || {}),
      // Defensive: ensure the map is always an object even if a stale/blank
      // value sneaks in.
      dismissedCallouts: { ...(parsed?.dismissedCallouts || {}) },
    }
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

/** True if the rep has dismissed the callout with this key. */
export function isCalloutDismissed(key) {
  if (!key) return false
  return read().dismissedCallouts[key] === true
}

/** Mark a callout dismissed and return the new full prefs object. */
export function dismissCallout(key) {
  if (!key) return read()
  const cur = read()
  const next = {
    ...cur,
    dismissedCallouts: { ...cur.dismissedCallouts, [key]: true },
  }
  write(next)
  return next
}

/**
 * Clear all dismissed callouts — brings every (still-relevant) card back.
 * Handy for a "reset" affordance later if we want one.
 */
export function resetDismissedCallouts() {
  const next = { ...read(), dismissedCallouts: {} }
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
