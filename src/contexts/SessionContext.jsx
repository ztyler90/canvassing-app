/**
 * SessionContext
 * Holds all live state for an active canvassing session:
 * - GPS trail points
 * - Door knock / interaction list
 * - Running stats (doors, revenue, etc.)
 * - Current pending knock (for auto-prompting the interaction modal)
 *
 * Crash / refresh resilience
 * ─────────────────────────
 * This context writes a compact snapshot to localStorage on every
 * mutation so a browser refresh, tab close, or mobile-Safari cold
 * restart doesn't lose in-flight session data. On mount we restore
 * from that snapshot for instant UI, then RepHome.checkActiveSession
 * does a fresh DB pull and dispatches HYDRATE_SESSION to reconcile.
 *
 * Source-of-truth ordering:
 *   1. Supabase DB (authoritative, survives device loss)
 *   2. localStorage cache (fast cold-start, survives refresh)
 *   3. In-memory React state (active UI)
 */
import { createContext, useContext, useEffect, useReducer, useRef } from 'react'

const SessionContext = createContext(null)

const STORAGE_KEY = 'knockiq:active-session-v1'

const initialState = {
  session:          null,         // Supabase session row
  gpsTrail:         [],           // [{ lat, lng }]
  interactions:     [],           // logged interactions
  pendingKnock:     null,         // { lat, lng, address } — triggers modal
  stats: {
    doors:         0,
    conversations: 0,
    estimates:     0,
    bookings:      0,
    revenue:       0,
    startedAt:     null,
  },
  isRunning:        false,
}

// Re-derive stats from a list of saved interactions. Used on HYDRATE_SESSION
// so the totals always match what's in the DB — no drift from reducer bugs.
function statsFromInteractions(interactions, startedAt) {
  const out = {
    doors:         interactions.length,
    conversations: 0,
    estimates:     0,
    bookings:      0,
    revenue:       0,
    startedAt,
  }
  for (const i of interactions) {
    if (['not_interested', 'estimate_requested', 'booked'].includes(i.outcome)) out.conversations++
    if (i.outcome === 'estimate_requested' || i.outcome === 'booked') out.estimates++
    if (i.outcome === 'booked') {
      out.bookings++
      out.revenue += Number(i.estimated_value) || 0
    }
  }
  return out
}

function reducer(state, action) {
  switch (action.type) {
    case 'START_SESSION':
      return {
        ...initialState,
        session:   action.session,
        isRunning: true,
        stats: {
          ...initialState.stats,
          // Prefer DB timestamp so refresh doesn't reset the elapsed clock.
          startedAt: action.session?.started_at
            ? new Date(action.session.started_at).getTime()
            : Date.now(),
        },
      }

    // HYDRATE_SESSION: re-enter a session already persisted to Supabase
    // (refresh, app re-open, iOS Safari cold-start after tab eviction).
    // Replaces in-memory state with the authoritative DB version.
    case 'HYDRATE_SESSION': {
      const { session, interactions = [], pendingKnock = null } = action
      if (!session) return state
      const startedAt = session.started_at
        ? new Date(session.started_at).getTime()
        : Date.now()
      return {
        ...initialState,
        session,
        interactions,
        pendingKnock,
        isRunning: true,
        stats: statsFromInteractions(interactions, startedAt),
      }
    }

    case 'STOP_SESSION':
      return { ...state, isRunning: false }

    case 'ADD_GPS_POINT':
      return { ...state, gpsTrail: [...state.gpsTrail, action.point] }

    // Fired immediately when GPS knock is detected — increments door count
    // right away so it's registered even if the rep never touches the modal.
    case 'REGISTER_KNOCK':
      return {
        ...state,
        pendingKnock: action.knock,
        stats: { ...state.stats, doors: state.stats.doors + 1 },
      }

    case 'SET_PENDING_KNOCK':
      return { ...state, pendingKnock: action.knock }

    case 'CLEAR_PENDING_KNOCK':
      return { ...state, pendingKnock: null }

    case 'LOG_INTERACTION': {
      const interaction = action.interaction
      const isConversation = ['not_interested', 'estimate_requested', 'booked'].includes(interaction.outcome)
      // A booking always counts as an estimate too — you can't book without
      // first quoting the job. This keeps bookings <= estimates by construction.
      const isEstimate     = interaction.outcome === 'estimate_requested' || interaction.outcome === 'booked'
      const isBooked       = interaction.outcome === 'booked'
      // countDoor: true for manual logs (door not yet counted),
      //            false for auto-detected knocks (already counted by REGISTER_KNOCK)
      const doorsIncrement = action.countDoor ? 1 : 0
      return {
        ...state,
        interactions: [...state.interactions, interaction],
        pendingKnock: null,
        stats: {
          ...state.stats,
          doors:         state.stats.doors + doorsIncrement,
          conversations: state.stats.conversations + (isConversation ? 1 : 0),
          estimates:     state.stats.estimates     + (isEstimate ? 1 : 0),
          bookings:      state.stats.bookings      + (isBooked ? 1 : 0),
          revenue:       state.stats.revenue       + (isBooked ? (Number(interaction.estimated_value) || 0) : 0),
        },
      }
    }

    // Replace an interaction after edit — recompute the stat deltas so that
    // changing "no answer" → "booked" on an existing pin lifts the totals
    // correctly (and changing the other direction backs them out).
    case 'REPLACE_INTERACTION': {
      const next = action.interaction
      const key  = (i) => i.id ?? `${i.lat},${i.lng},${i.created_at ?? ''}`
      const idx  = state.interactions.findIndex((i) => key(i) === key(next))
      if (idx < 0) return state

      const prev        = state.interactions[idx]
      const wasConv     = ['not_interested', 'estimate_requested', 'booked'].includes(prev.outcome)
      const wasEst      = prev.outcome === 'estimate_requested' || prev.outcome === 'booked'
      const wasBooked   = prev.outcome === 'booked'
      const isConv      = ['not_interested', 'estimate_requested', 'booked'].includes(next.outcome)
      const isEst       = next.outcome === 'estimate_requested' || next.outcome === 'booked'
      const isBooked    = next.outcome === 'booked'
      const prevRevenue = wasBooked  ? (Number(prev.estimated_value) || 0) : 0
      const newRevenue  = isBooked   ? (Number(next.estimated_value) || 0) : 0

      const updated = [...state.interactions]
      updated[idx] = { ...prev, ...next }

      return {
        ...state,
        interactions: updated,
        stats: {
          ...state.stats,
          // doors unchanged — the house was already counted
          conversations: state.stats.conversations + (isConv ? 1 : 0) - (wasConv ? 1 : 0),
          estimates:     state.stats.estimates     + (isEst ? 1 : 0)  - (wasEst ? 1 : 0),
          bookings:      state.stats.bookings      + (isBooked ? 1 : 0) - (wasBooked ? 1 : 0),
          revenue:       Math.max(0, state.stats.revenue + newRevenue - prevRevenue),
        },
      }
    }

    case 'RESET':
      return initialState

    default:
      return state
  }
}

// Load initial state from localStorage (best-effort — any JSON or storage
// error just returns the default initialState and we fall through to DB).
function loadFromStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return initialState
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    const cached = JSON.parse(raw)
    if (!cached?.session?.id || !cached?.isRunning) return initialState
    return {
      ...initialState,
      session:      cached.session,
      interactions: Array.isArray(cached.interactions) ? cached.interactions : [],
      pendingKnock: cached.pendingKnock || null,
      isRunning:    true,
      stats: statsFromInteractions(
        cached.interactions || [],
        cached.session.started_at ? new Date(cached.session.started_at).getTime() : Date.now(),
      ),
    }
  } catch {
    return initialState
  }
}

// Persist a compact snapshot to localStorage. We intentionally DON'T store
// the GPS trail — it can be huge (thousands of points) and it's purely
// visual. Trails redraw as the rep keeps moving after resume.
function saveToStorage(state) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (!state.isRunning || !state.session?.id) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    const snapshot = {
      session:      state.session,
      interactions: state.interactions,
      pendingKnock: state.pendingKnock,
      isRunning:    state.isRunning,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Storage full or blocked (private mode) — silently ignore; the DB
    // remains the source of truth.
  }
}

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadFromStorage)
  const doorKnockRef = useRef(null)   // DoorKnockDetector instance

  // Persist on every state change. localStorage writes are synchronous and
  // cheap (<1ms for typical snapshots <20KB).
  useEffect(() => { saveToStorage(state) }, [state])

  return (
    <SessionContext.Provider value={{ state, dispatch, doorKnockRef }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
