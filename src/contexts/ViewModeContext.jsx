/**
 * ViewModeContext — lets a platform manager who also knocks doors flip between
 * the Manager dashboard and the rep-side Canvassing UI without changing their
 * role. The user's `role` stays 'manager' (so permissions, billing seat, and
 * the manager roster are unaffected); this is purely a client-side "which tree
 * do I render" switch consumed by App.jsx and the header ViewModeSwitch.
 *
 * Persistence is deliberately device-aware:
 *
 *   • Desktop  — always boot into Manager view at the start of each session.
 *     A manager at their computer is almost always there to review the team,
 *     so we never silently drop them into the canvassing UI on load.
 *
 *   • Mobile / native app — restore the manager's LAST choice from
 *     localStorage. A manager who spends the day knocking on their phone
 *     stays in Rep view across app restarts instead of having to re-flip
 *     every time they reopen the app.
 *
 * For non-managers (reps, closers) `canSwitch` is false and viewMode is always
 * 'manager' (an inert value that App.jsx ignores for those roles).
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'

const ViewModeContext = createContext(null)
const STORAGE_PREFIX = 'knockiq:viewMode:'

/**
 * Best-effort "is this a phone / native app" check. We treat coarse pointers,
 * narrow viewports, and known mobile UA strings (incl. the Capacitor WebView)
 * as mobile. A false negative just means a manager gets Manager view on boot
 * (the safe default), so we don't need this to be perfect.
 */
function isMobileDevice() {
  if (typeof window === 'undefined') return false
  try {
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches
    const narrow = window.matchMedia?.('(max-width: 768px)')?.matches
    const ua     = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
    return !!(coarse || narrow || ua)
  } catch {
    return false
  }
}

export function ViewModeProvider({ children }) {
  const { user } = useAuth()
  const canSwitch = user?.role === 'manager'
  const userId    = user?.id || null

  // Default 'manager' until we resolve the per-user / per-device choice below.
  const [viewMode, setViewModeState] = useState('manager')

  // (Re)initialize whenever the signed-in manager changes. Desktop ignores any
  // stored value and starts in Manager view; mobile restores the last choice.
  useEffect(() => {
    if (!canSwitch || !userId) {
      setViewModeState('manager')
      return
    }
    if (isMobileDevice()) {
      try {
        const stored = localStorage.getItem(STORAGE_PREFIX + userId)
        setViewModeState(stored === 'rep' ? 'rep' : 'manager')
      } catch {
        setViewModeState('manager')
      }
    } else {
      setViewModeState('manager')
    }
  }, [canSwitch, userId])

  const setViewMode = (mode) => {
    const next = mode === 'rep' ? 'rep' : 'manager'
    setViewModeState(next)
    // Persist for the mobile-restore path. Writing on desktop is harmless —
    // the init effect above never reads it back there.
    try {
      if (userId) localStorage.setItem(STORAGE_PREFIX + userId, next)
    } catch {
      /* localStorage blocked — in-memory state still works for this session */
    }
  }

  const value = useMemo(() => ({
    // Force 'manager' for anyone who can't switch so consumers never have to
    // special-case role themselves.
    viewMode: canSwitch ? viewMode : 'manager',
    setViewMode,
    canSwitch,
  }), [canSwitch, viewMode, userId])

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>
}

export function useViewMode() {
  const ctx = useContext(ViewModeContext)
  if (!ctx) throw new Error('useViewMode must be used within ViewModeProvider')
  return ctx
}
