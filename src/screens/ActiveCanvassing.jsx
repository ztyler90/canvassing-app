import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Square, MapPin, Clock, Home, Pin, X, Signal } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import { gpsTracker } from '../lib/gps.js'
import { endSession, updateSessionStats, getRepTerritories, getDoNotKnockList, upsertRepLocation, clearRepLocation, getWebhookUrl, fireZapierWebhook, getRepRecentInteractions } from '../lib/supabase.js'
import { acquireWakeLock, releaseWakeLock, isWakeLockSupported } from '../lib/wakeLock.js'
import { usePrefs } from '../lib/prefs.js'
import { dnkZones, pointInAnyZone, loadDnkZones } from '../lib/dnk.js'
import { bucketIntoCells, filterByWindow, HEATMAP_COLORS } from '../lib/heatmap.js'
import MapView from '../components/MapView.jsx'
import InteractionModal from '../components/InteractionModal.jsx'

// How long a "Log this door" pill stays on screen when auto-open is off.
// After this the pending knock is cleared; the rep can still log manually.
const PENDING_PILL_TIMEOUT_MS = 60_000

// Undo-knock toast — visible for 10s on every auto-detected knock so a
// rep who got a false-positive can one-tap the door count back off. After
// this the toast fades and normal modal/pill flow continues uninterrupted.
const UNDO_TOAST_MS = 10_000

// Short buzz on auto-knock detection. 80ms is long enough to feel
// through a pants-pocket phone without sounding like an alert. We only
// fire it for auto-detected knocks — manual logs aren't surprises.
const KNOCK_HAPTIC_MS = 80

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
  // knockToast holds the most recently detected knock while the 10s
  // "Undo" window is open. Decoupled from pendingKnock so dismissing the
  // toast doesn't also clear the modal/pill.
  const [knockToast, setKnockToast]   = useState(null)
  // Most recent GPS accuracy in meters (null until first fix). Drives the
  // traffic-light indicator in the header. Held as state so the widget
  // re-renders every time a new reading comes in.
  const [gpsAccuracy, setGpsAccuracy] = useState(null)
  // Timestamp of most recent fix — we show a dimmed indicator if no
  // reading has arrived in > GPS_STALE_MS (handled in the quality calc).
  const [gpsStamp, setGpsStamp]       = useState(0)
  const timerRef                    = useRef(null)
  const locationBroadcastRef        = useRef(null)
  const currentPosRef               = useRef(null)
  const prefs                       = usePrefs()

  // Load rep's assigned territories and DNK list. Polygon DNK zones
  // live in a separate module-level cache — we just trigger a reload
  // here and the detector already reads from it synchronously. Keeping
  // a local React copy so the map can re-render when it arrives.
  const [dnkPolys, setDnkPolys] = useState(() => [...dnkZones])
  useEffect(() => {
    if (!user?.id) return
    getRepTerritories(user.id).then(setTerritories).catch(() => {})
    getDoNotKnockList().then(setDoNotKnock).catch(() => {})
    loadDnkZones()
      .then(() => setDnkPolys([...dnkZones]))
      .catch(() => {})
  }, [user?.id])

  // True when the rep's current position sits inside a DNK polygon. Used
  // to render the amber banner and to confirm the detector will correctly
  // suppress knocks (detector does its own check on every frame — this is
  // purely for the UX signal).
  const inDnkZone = currentPos
    ? pointInAnyZone(currentPos.lat, currentPos.lng, dnkPolys)
    : false

  // ── Coverage heatmap ────────────────────────────────────────────
  // Off by default — some reps find it visually noisy. When enabled, we
  // pull up to 30d of history once per session and filter client-side as
  // the rep flips the window selector. Skipping the pull when the layer
  // is off keeps the session start path fast.
  const [heatmapOn, setHeatmapOn]         = useState(false)
  const [heatmapWindow, setHeatmapWindow] = useState(7)     // 1 | 7 | 30 days
  const [heatmapRows, setHeatmapRows]     = useState([])
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  useEffect(() => {
    if (!heatmapOn || !user?.id || heatmapRows.length) return
    setHeatmapLoading(true)
    getRepRecentInteractions(user.id, 30)
      .then((rows) => setHeatmapRows(rows))
      .catch(() => {})
      .finally(() => setHeatmapLoading(false))
  }, [heatmapOn, user?.id, heatmapRows.length])
  // Cells re-bucket instantly when the window toggle changes (no refetch).
  const heatmapCells = heatmapOn
    ? bucketIntoCells(filterByWindow(heatmapRows, heatmapWindow))
    : []

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
      if (Number.isFinite(last.accuracy)) {
        setGpsAccuracy(last.accuracy)
        setGpsStamp(Date.now())
      }
    }

    // Chain into gpsTracker's callback — preserve whatever was set in RepHome
    const prevOnPosition = gpsTracker.onPosition
    gpsTracker.onPosition = (point) => {
      prevOnPosition?.(point)
      const p = { lat: point.lat, lng: point.lng }
      setCurrentPos(p)
      currentPosRef.current = p
      if (Number.isFinite(point.accuracy)) {
        setGpsAccuracy(point.accuracy)
        setGpsStamp(Date.now())
      }
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

  // Fire the haptic + open the undo toast the moment a fresh knock is
  // detected. We gate on `knockedAt` so we don't re-fire if the reducer
  // replays the same pendingKnock (e.g. during a hydrate). Skip the
  // 45-second long-stop auto-prompt — that's the "conversation" prompt,
  // not a fresh detection, and users don't need to "undo" it.
  const lastHapticForRef = useRef(null)
  useEffect(() => {
    if (!pendingKnock) return
    if (pendingKnock.autoPrompt) return
    const key = pendingKnock.knockedAt || `${pendingKnock.lat},${pendingKnock.lng}`
    if (lastHapticForRef.current === key) return
    lastHapticForRef.current = key

    // Vibrate (ignore on desktop / browsers that don't support it).
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(KNOCK_HAPTIC_MS) } catch { /* ignore */ }
    }
    // Show the undo toast.
    setKnockToast(pendingKnock)
  }, [pendingKnock])

  // Auto-dismiss the undo toast after UNDO_TOAST_MS.
  useEffect(() => {
    if (!knockToast) return
    const t = setTimeout(() => setKnockToast(null), UNDO_TOAST_MS)
    return () => clearTimeout(t)
  }, [knockToast])

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
          dnkZones={dnkPolys}
          heatmapCells={heatmapCells}
          followUser
          onInteractionClick={(interaction) => setEditingInteraction(interaction)}
          className="w-full h-full"
        />

        {/* GPS quality traffic-light chip. Color + label reflects the
            accuracy radius reported by the most recent fix, with a stale
            gate so a dead GPS link doesn't keep showing "Strong". */}
        <GpsQualityChip accuracy={gpsAccuracy} stamp={gpsStamp} />

        {/* Coverage heatmap toggle + 24h/7d/30d selector. Sits in the
            top-right so it doesn't collide with the GPS chip. When off,
            nothing renders on the map; when on, cells are fetched once
            and re-bucketed locally as the window changes. */}
        <HeatmapControl
          on={heatmapOn}
          loading={heatmapLoading}
          windowDays={heatmapWindow}
          onToggle={() => setHeatmapOn((v) => !v)}
          onWindow={setHeatmapWindow}
        />

        {/* Do-Not-Knock zone banner — appears if the rep walks into a
            polygon zone (HOA, school, cooldown). Amber rather than red
            because the zone isn't a rule violation by itself — it's a
            heads-up that auto-detect will stay quiet here. */}
        {inDnkZone && (
          <div className="absolute top-14 left-3 right-3 sm:left-auto sm:right-3 sm:w-[360px] z-20 bg-red-50 border border-red-300 text-red-800 rounded-xl px-3 py-2 shadow-lg text-xs flex items-start gap-2">
            <span className="text-base leading-none">🚫</span>
            <div className="flex-1">
              <p className="font-semibold">
                Do Not Knock zone{inDnkZone.name ? ` — ${inDnkZone.name}` : ''}
              </p>
              <p className="mt-0.5 leading-snug text-red-700">
                {inDnkZone.reason || 'Auto-knock detection is paused here.'}
              </p>
            </div>
          </div>
        )}

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

      {/* 10-second undo toast. Floats at the bottom just above the action
          bar so it doesn't block the pill or the modal. Tapping Undo
          reverses the door count increment and clears the pending modal. */}
      {knockToast && (
        <UndoKnockToast
          durationMs={UNDO_TOAST_MS}
          onUndo={() => {
            dispatch({ type: 'UNDO_LAST_KNOCK' })
            setKnockToast(null)
            setTappedKnock(null)
          }}
          onDismiss={() => setKnockToast(null)}
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
 * HeatmapControl
 * ──────────────
 * Compact top-right control with a toggle button and three radio chips
 * for the lookback window. When the toggle is off we hide the chips
 * entirely — a rep who doesn't want the heatmap shouldn't see clutter.
 *
 * Legend is intentionally terse (color dots + "24h / 7d / 30d") because
 * the map shading itself teaches the recency scale. Tapping the label
 * cycles the window, which matches the "flip fast" mental model better
 * than a dropdown.
 */
function HeatmapControl({ on, loading, windowDays, onToggle, onWindow }) {
  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-1">
      <button
        onClick={onToggle}
        aria-pressed={on}
        className={`flex items-center gap-1.5 bg-white/95 backdrop-blur rounded-full px-3 py-1.5 shadow text-xs font-semibold ${on ? 'text-blue-700' : 'text-gray-700'}`}
      >
        <span
          className={`w-2 h-2 rounded-full ${on ? 'bg-blue-500' : 'bg-gray-400'}`}
        />
        Coverage{loading ? '…' : ''}
      </button>
      {on && (
        <div className="bg-white/95 backdrop-blur rounded-full shadow flex text-[11px] font-semibold overflow-hidden">
          {[
            { d: 1,  label: '24h', color: HEATMAP_COLORS.fresh.fill  },
            { d: 7,  label: '7d',  color: HEATMAP_COLORS.recent.fill },
            { d: 30, label: '30d', color: HEATMAP_COLORS.older.fill  },
          ].map((w) => (
            <button
              key={w.d}
              onClick={() => onWindow(w.d)}
              className={`px-2.5 py-1.5 flex items-center gap-1 ${windowDays === w.d ? 'bg-gray-900 text-white' : 'text-gray-600'}`}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: w.color }} />
              {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * GpsQualityChip
 * ──────────────
 * Small pill in the top-left of the map with a colored dot + short
 * label that reflects the current GPS accuracy.
 *
 * Thresholds are chosen for door-knocking accuracy needs:
 *   ≤ 10 m  — reliable reverse-geocoding onto the right house (green)
 *   ≤ 25 m  — usually right, may snap to the house next door (amber)
 *   > 25 m  — stop-detection will fire but the address is suspect (red)
 *   stale   — no fix in 20 s, GPS may have been paused by the OS (gray)
 */
function GpsQualityChip({ accuracy, stamp }) {
  const stale = !stamp || (Date.now() - stamp) > 20_000

  let label, dot, textColor
  if (stale || accuracy == null) {
    label = 'Searching…'; dot = 'bg-gray-400';  textColor = 'text-gray-600'
  } else if (accuracy <= 10) {
    label = 'GPS strong';  dot = 'bg-green-500'; textColor = 'text-green-700'
  } else if (accuracy <= 25) {
    label = 'GPS fair';    dot = 'bg-amber-500'; textColor = 'text-amber-700'
  } else {
    label = 'GPS weak';    dot = 'bg-red-500';   textColor = 'text-red-700'
  }
  const accLabel = stale || accuracy == null ? '' : ` · ±${Math.round(accuracy)}m`

  return (
    <div className="absolute top-3 left-3 flex items-center gap-2 bg-white/95 backdrop-blur rounded-full px-3 py-1.5 shadow text-xs font-medium">
      <span className={`w-2 h-2 rounded-full ${dot} ${stale ? '' : 'animate-pulse'}`} />
      <Signal className={`w-3 h-3 ${textColor}`} />
      <span className={textColor}>
        {label}<span className="text-gray-500">{accLabel}</span>
      </span>
    </div>
  )
}

/**
 * UndoKnockToast
 * ──────────────
 * Dark pill sliding up from the bottom showing "Knock detected. Undo?"
 * with a visual progress bar that drains over `durationMs`. After the bar
 * drains the toast silently disappears (parent already has a timeout).
 * Undo tap fires the parent's undo handler immediately.
 *
 * We intentionally keep this component dumb — it doesn't read session
 * state, just renders the countdown and calls back. Makes it trivially
 * reusable if we add other "undo" surfaces later (undo-last-log, etc.).
 */
function UndoKnockToast({ durationMs, onUndo, onDismiss }) {
  // Progress is a single ref-backed CSS transition — cheaper than
  // re-rendering every 16ms with setInterval. Mount animation kicks in
  // after a frame so the bar visibly slides from 100% → 0%.
  const [progressPct, setProgressPct] = useState(100)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setProgressPct(0))
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="absolute bottom-20 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[380px] z-30 pointer-events-none">
      <div className="bg-gray-900/95 backdrop-blur text-white rounded-2xl shadow-2xl px-3.5 py-3 flex items-center gap-3 pointer-events-auto">
        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
          <Pin className="w-4 h-4 text-blue-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Knock detected</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Counted as a door — tap to undo</p>
        </div>
        <button
          onClick={onUndo}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-900 bg-white active:opacity-80 shrink-0"
        >
          Undo
        </button>
        <button
          onClick={onDismiss}
          className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 active:bg-white/10 shrink-0"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Drain bar */}
      <div className="mx-1 mt-1 h-[3px] rounded-full bg-gray-900/40 overflow-hidden pointer-events-none">
        <div
          className="h-full bg-blue-400"
          style={{
            width: `${progressPct}%`,
            transition: `width ${durationMs}ms linear`,
          }}
        />
      </div>
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
