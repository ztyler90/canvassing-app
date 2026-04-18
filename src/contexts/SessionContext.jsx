/**
 * SessionContext
 * Holds all live state for an active canvassing session:
 * - GPS trail points
 * - Door knock / interaction list
 * - Running stats (doors, revenue, etc.)
 * - Current pending knock (for auto-prompting the interaction modal)
 */
import { createContext, useContext, useReducer, useRef } from 'react'

const SessionContext = createContext(null)

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

function reducer(state, action) {
  switch (action.type) {
    case 'START_SESSION':
      return {
        ...initialState,
        session:   action.session,
        isRunning: true,
        stats: { ...initialState.stats, startedAt: Date.now() },
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

export function SessionProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const doorKnockRef = useRef(null)   // DoorKnockDetector instance

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
