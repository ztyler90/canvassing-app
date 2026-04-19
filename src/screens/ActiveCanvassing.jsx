import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Square, MapPin, Clock, Home, Pin, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import { gpsTracker } from '../lib/gps.js'
import { endSession, updateSessionStats, getRepTerritories, getDoNotKnockList, upsertRepLocation, clearRepLocation, getWebhookUrl, fireZapierWebhook } from '../lib/supabase.js'
import { acquireWakeLock, releaseWakeLock, isWakeLockSupported } from '../lib/wakeLock.js'
import { usePrefs } from '../lib/prefs.js'
import MapView from '../components/MapView.jsx'
import InteractionModal from '../components/InteractionModal.jsx'

// How long a "Log this door" pill stays on screen when auto-open is off.
// After this the pending knock is cleared; the rep can still log manually.
const PENDING_PILL_TIMEOUT_MS = 60_000

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue

export default function ActiveCanvassing() {
  const { user }                    = useAuth()
  const { state, dispatch, doorKnockRef } = useSession()
  const navigate                    = useNavigate()

  const [elapsed, setElapsed]       = useState(0)   // seconds
  const [stopping, setStopping]     = useState(false)
  const [showManualLog, setShowManualLog] = useState(false)
  const [editingInteraction, setEditingInteraction] = useState(null)
  // When auto-open is off, tapping the pill sets this — it drives the modal
  // render path so the pendingKnock pill and opened modal don't both show.
  const [tappedKnock, setTappedKnock] = useState(null)
  const [currentPos, setCurrentPos] = useState(null)
  const [territories, setTerritories] = useState([])
  const [doNotKnock, setDoNotKnock]   = useState([])
  const [showWakeWarning, setShowWakeWarning] = useState(false)
  const timerRef                    = useRef(null)
  const locationBroadcastRef        = useRef(null)
  const currentPosRef               = useRef(null)
  const prefs                       = usePrefs()

  // Load rep's assigned territories and DNK list
  useEffect(() => {
    if (!user?.id) return
    getRepTerritories(user.id).then(setTerritories).catch(() => {})
    getDoNotKnockList().then(setDoNotKnock).catch(() => {})
  }, [user?.id])

  // Warn the rep before a refresh / tab-close destroys the active session.
  // Resilience is the DB + localStorage cache (they can resume exactly where
  // they left off) — but a confirm dialog prevents the 99% case of an
  // accidental pull-to-refresh gesture mid-canvass.
  useEffect(() => {
    if (!state.isRunning) return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      // The returnValue string is shown by older browsers; modern ones
      // display their own generic message but still require the prompt.
      e.returnValue = 'A canvassing session is in progress. Leaving will pause tracking.'
      return e.returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state.isRunning])

  // Keep the screen on while a session is active so GPS tracking doesn't
  // drop when the phone auto-sleeps. Note: a *manually* locked phone or
  // backgrounded tab will still pause JS — that's a browser limitation.
  // True phone-in-pocket tracking needs a native wrapper (Capacitor).
  useEffect(() => {
    if (!state.isRunning) return
    let cancelled = false
    acquireWakeLock().then((ok) => {
      if (cancelled) return
      // Only show the "manually locked" warning if Wake Lock isn't even
      // supported — otherwise the lock keeps the screen alive.
      if (!ok && !isWakeLockSupported()) setShowWakeWarning(true)
    })

    // If the user backgrounds the tab (switches apps, gets a call, locks
    // the phone), warn them on return that tracking paused.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setShowWakeWarning(true)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      releaseWakeLock()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [state.isRunning])

  // Broadcast GPS position to Supabase every 15s for live manager map
  // Includes retry logic for network transitions (WiFi → cellular) and
  // an 'online' listener so the rep reconnects immediately after regaining signal
  useEffect(() => {
    if (!user?.id || !state.session?.id) return
    let retryTimeout = null
    let intervalId = null

    const broadcast = async (retries = 3, delay = 2000) => {
      const pos = currentPosRef.current
      if (!pos) return
      try {
        await upsertRepLocation(user.id, state.session.id, pos.lat, pos.lng)
      } catch (_e) {
        if (retries > 0) {
          retryTimeout = setTimeout(() => broadcast(retries - 1, delay * 2), delay)
        }
      }
    }

    broadcast() // immediate first push
    intervalId = setInterval(broadcast, 15000)
    locationBroadcastRef.current = intervalId

    // When device regains connectivity (WiFi→cell handoff), push immediately
    const onOnline = () => broadcast()
    window.addEventListener('online', onOnline)

    return () => {
      clearInterval(intervalId)
      if (retryTimeout) clearTimeout(retryTimeout)
      window.removeEventListener('online', onOnline)
      clearRepLocation(user.id).catch(() => {}) // remove row when session ends
    }
  }, [user?.id, state.session?.id])

  // Redirect if no active session
  useEffect(() => {
    if (!state.session && !state.isRunning) {
      navigate('/', { replace: true })
    }
  }, [state.session, state.isRunning])

  // Timer
  useEffect(() => {
    if (!state.stats.startedAt) return
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.stats.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [state.stats.startedAt])

  // Track current position for the blue dot.
  // We hook into gpsTracker's existing onPosition callback rather than
  // opening a second watchPosition (which wastes battery on field devices).
  useEffect(() => {
    // Seed from the last known position immediately
    const last = gpsTracker.getLastPosition()
    if (last) {
      const p = { lat: last.lat, lng: last.lng }
      setCurrentPos(p)
      currentPosRef.current = p
    }

    // Chain into gpsTracker's callback — preserve whatever was set in RepHome
    const prevOnPosition = gpsTracker.onPosition
    gpsTracker.onPosition = (point) => {
      prevOnPosition?.(point)
      const p = { lat: point.lat, lng: point.lng }
      setCurrentPos(p)
      currentPosRef.current = p
    }

    return () => {
      gpsTracker.onPosition = prevOnPosition
    }
  }, [])

  const formatTime = (secs) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const doorsPerHour = elapsed > 60
    ? ((state.stats.doors / (elapsed / 3600))).toFixed(1)
    : '—'

  const handleStop = async () => {
    setStopping(true)

    // Stop GPS + door knock detector
    gpsTracker.stop()
    doorKnockRef.current?.reset()

    // Persist final stats
    const summary = {
      doors_knocked:  state.stats.doors,
      conversations:  state.stats.conversations,
      estimates:      state.stats.estimates,
      bookings:       state.stats.bookings,
      revenue_booked: state.stats.revenue,
    }
    const { data: endedSession } = await endSession(state.session.id, summary)
    dispatch({ type: 'STOP_SESSION' })

    // Fire Zapier webhook if configured
    try {
      const webhookUrl = await getWebhookUrl()
      if (webhookUrl) {
        await fireZapierWebhook(webhookUrl, {
          event:          'session_ended',
          rep_name:       user?.full_name  || '',
          rep_email:      user?.email      || '',
          session_id:     state.session.id,
          started_at:     endedSession?.started_at || state.session.started_at,
          ended_at:       endedSession?.ended_at   || new Date().toISOString(),
          doors_knocked:  summary.doors_knocked,
          conversations:  summary.conversations,
          estimates:      summary.estimates,
          bookings:       summary.bookings,
          revenue_booked: summary.revenue_booked,
        })
      }
    } catch (e) {
      console.warn('[Webhook] Error firing webhook:', e)
    }

    navigate('/summary', { replace: true })
  }

  // Auto-prompt when a door knock is detected
  const pendingKnock = state.pendingKnock

  // Auto-dismiss the "Log this door" pill after PENDING_PILL_TIMEOUT_MS.
  // Only active when auto-open is off — in auto-open mode the modal itself
  // handles dismissal. The long-stop (45 s) auto-prompt always honors the
  // auto-open pref too, so we don't auto-bump the modal in manual mode.
  useEffect(() => {
    if (prefs.autoOpenInteractionModal) return
    if (!pendingKnock) return
    if (tappedKnock) return   // rep already engaged — don't auto-dismiss
    const t = setTimeout(() => {
      dispatch({ type: 'CLEAR_PENDING_KNOCK' })
    }, PENDING_PILL_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [prefs.autoOpenInteractionModal, pendingKnock, tappedKnock, dispatch])

  return (
    <div className="flex flex-col bg-gray-100 overflow-hidden" style={{ height: '100dvh' }}>

      {/* Top Stats Bar */}
      <div className="px-4 py-3 flex items-center justify-between shadow-sm z-10"
        style={{ backgroundColor: BRAND_GREEN }}>
        <div className="flex items-center gap-1 text-white">
          <Clock className="w-4 h-4 text-blue-300" />
          <span className="font-mono text-lg font-bold">{formatTime(elapsed)}</span>
        </div>
        <div className="flex items-center gap-1 text-white">
          <Home className="w-4 h-4 text-blue-300" />
          <span className="text-lg font-bold">{state.stats.doors}</span>
          <span className="text-blue-300 text-sm ml-0.5">doors</span>
        </div>
        <div className="text-white text-right">
          <span className="text-lg font-bold">${state.stats.revenue.toFixed(0)}</span>
          <span className="text-blue-300 text-sm ml-0.5">booked</span>
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="bg-white border-b flex divide-x divide-gray-100">
        <MiniStat label="Convos"   value={state.stats.conversations} />
        <MiniStat label="Estimates" value={state.stats.estimates} />
        <MiniStat label="Booked"   value={state.stats.bookings} color="text-green-600" />
        <MiniStat label="Doors/hr" value={doorsPerHour} />
      </div>

      {/* Map — fills remaining space */}
      <div className="flex-1 relative">
        <MapView
          trail={state.gpsTrail}
          interactions={state.interactions}
          currentPos={currentPos}
          territories={territories}
          doNotKnock={doNotKnock}
          followUser
          onInteractionClick={(interaction) => setEditingInteraction(interaction)}
          className="w-full h-full"
        />

        {/* Floating pulse indicator */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-white/90 backdrop-blur rounded-full px-3 py-1.5 shadow text-xs font-medium text-gray-700">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Tracking
        </div>

        {/* Wake-lock advisory — appears if the device tab was backgrounded */}
        {showWakeWarning && (
          <div className="absolute top-3 right-3 left-3 sm:left-auto sm:max-w-xs bg-amber-50 border border-amber-300 text-amber-800 rounded-xl px-3 py-2 shadow-lg text-xs flex items-start gap-2">
            <span>⚠️</span>
            <div className="flex-1">
              <p className="font-semibold">Keep this screen open</p>
              <p className="mt-0.5 leading-snug">
                GPS pauses when the phone locks or the browser is in the
                background. For pocket tracking, install the native app.
              </p>
            </div>
            <button
              onClick={() => setShowWakeWarning(false)}
              className="text-amber-700 hover:text-amber-900 text-base leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* Bottom Bar */}
      <div className="bg-white border-t px-4 py-3 flex items-center gap-3 safe-area-bottom">
        {/* Manual log button */}
        <button
          onClick={() => setShowManualLog(true)}
          className="flex-1 py-3.5 rounded-xl border-2 text-sm font-semibold text-gray-700 border-gray-200 active:bg-gray-50"
        >
          + Log Interaction
        </button>

        {/* Stop button */}
        <button
          onClick={handleStop}
          disabled={stopping}
          className="flex items-center gap-2 px-5 py-3.5 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-60"
          style={{ backgroundColor: '#EF4444' }}
        >
          <Square className="w-4 h-4" fill="white" />
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {/*
        Door-knock pending UX. Two paths based on the auto-open pref:
        • ON  → open the modal automatically (legacy behavior).
        • OFF → show a dismissible "Log this door" pill at the top of the
                map; rep taps to open the modal. Pill auto-dismisses after
                60 s. The door has already been counted by REGISTER_KNOCK
                in either path, so saving the interaction never double-counts.
      */}
      {pendingKnock && prefs.autoOpenInteractionModal && (
        <InteractionModal
          knock={pendingKnock}
          sessionId={state.session?.id}
          repId={user?.id}
          onClose={() => dispatch({ type: 'CLEAR_PENDING_KNOCK' })}
          onSave={(interaction) => {
            dispatch({ type: 'LOG_INTERACTION', interaction, countDoor: false })
          }}
          isAuto
        />
      )}

      {pendingKnock && !prefs.autoOpenInteractionModal && !tappedKnock && (
        <PendingKnockPill
          knock={pendingKnock}
          onOpen={() => setTappedKnock(pendingKnock)}
          onDismiss={() => dispatch({ type: 'CLEAR_PENDING_KNOCK' })}
        />
      )}

      {tappedKnock && (
        <InteractionModal
          knock={tappedKnock}
          sessionId={state.session?.id}
          repId={user?.id}
          onClose={() => {
            setTappedKnock(null)
            dispatch({ type: 'CLEAR_PENDING_KNOCK' })
          }}
          onSave={(interaction) => {
            dispatch({ type: 'LOG_INTERACTION', interaction, countDoor: false })
            setTappedKnock(null)
          }}
          isAuto={false}
        />
      )}

      {/* Manual log modal */}
      {showManualLog && (
        <InteractionModal
          knock={currentPos ? { lat: currentPos.lat, lng: currentPos.lng, address: null } : null}
          sessionId={state.session?.id}
          repId={user?.id}
          onClose={() => setShowManualLog(false)}
          onSave={(interaction) => {
            // Manual log counts as a door knock
            dispatch({ type: 'LOG_INTERACTION', interaction, countDoor: true })
            setShowManualLog(false)
          }}
          isAuto={false}
        />
      )}

      {/* Edit-existing-interaction modal (tap pin on the map) */}
      {editingInteraction && (
        <InteractionModal
          knock={{
            lat:     editingInteraction.lat,
            lng:     editingInteraction.lng,
            address: editingInteraction.address,
          }}
          sessionId={state.session?.id}
          repId={user?.id}
          existingInteraction={editingInteraction}
          onClose={() => setEditingInteraction(null)}
          onSave={(updated) => {
            // Replace the matching interaction in session state rather than
            // appending a new one. Stats don't get re-counted here — editing
            // the outcome of an existing knock would otherwise double-count.
            dispatch({
              type: 'REPLACE_INTERACTION',
              interaction: { ...editingInteraction, ...updated },
            })
            setEditingInteraction(null)
          }}
          isAuto={false}
        />
      )}
    </div>
  )
}

function MiniStat({ label, value, color = 'text-gray-900' }) {
  return (
    <div className="flex-1 py-1.5 text-center">
      <p className={`font-bold text-base ${color}`}>{value}</p>
      <p className="text-gray-400 text-xs">{label}</p>
    </div>
  )
}

/**
 * Non-modal pending-knock indicator. Rendered when auto-open is OFF and
 * the detector has flagged a stop. Shows the resolved address (or
 * "Door detected" if geocoding failed) with Log / dismiss affordances.
 * Positioned floating above the map, below the tracking pulse.
 */
function PendingKnockPill({ knock, onOpen, onDismiss }) {
  const addressLine = knock.address || 'Door detected'
  return (
    <div className="absolute top-14 left-3 right-3 sm:left-auto sm:right-3 sm:w-[360px] z-20">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 px-3 py-2.5 flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <Pin className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">
            Log this door
          </p>
          <p className="text-sm font-semibold text-gray-800 truncate">
            {addressLine}
          </p>
        </div>
        <button
          onClick={onOpen}
          className="px-3 py-2 rounded-xl text-xs font-bold text-white active:scale-[0.98]"
          style={{ backgroundColor: '#1B4FCC' }}
        >
          Log
        </button>
        <button
          onClick={onDismiss}
          className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 active:bg-gray-50"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
