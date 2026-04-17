import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Square, MapPin, Clock, Home } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import { gpsTracker } from '../lib/gps.js'
import { endSession, updateSessionStats, getRepTerritories, getDoNotKnockList, upsertRepLocation, clearRepLocation, getWebhookUrl, fireZapierWebhook } from '../lib/supabase.js'
import MapView from '../components/MapView.jsx'
import InteractionModal from '../components/InteractionModal.jsx'

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue

export default function ActiveCanvassing() {
  const { user }                    = useAuth()
  const { state, dispatch, doorKnockRef } = useSession()
  const navigate                    = useNavigate()

  const [elapsed, setElapsed]       = useState(0)   // seconds
  const [stopping, setStopping]     = useState(false)
  const [showManualLog, setShowManualLog] = useState(false)
  const [currentPos, setCurrentPos] = useState(null)
  const [territories, setTerritories] = useState([])
  const [doNotKnock, setDoNotKnock]   = useState([])
  const timerRef                    = useRef(null)
  const locationBroadcastRef        = useRef(null)
  const currentPosRef               = useRef(null)

  // Load rep's assigned territories and DNK list
  useEffect(() => {
    if (!user?.id) return
    getRepTerritories(user.id).then(setTerritories).catch(() => {})
    getDoNotKnockList().then(setDoNotKnock).catch(() => {})
  }, [user?.id])

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

  // Track current position for the blue dot
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setCurrentPos(p)
        currentPosRef.current = p
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
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
          className="w-full h-full"
        />

        {/* Floating pulse indicator */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-white/90 backdrop-blur rounded-full px-3 py-1.5 shadow text-xs font-medium text-gray-700">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Tracking
        </div>
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

      {/* Auto-prompt modal (door knock detected) */}
      {pendingKnock && (
        <InteractionModal
          knock={pendingKnock}
          sessionId={state.session?.id}
          repId={user?.id}
          onClose={() => dispatch({ type: 'CLEAR_PENDING_KNOCK' })}
          onSave={(interaction) => dispatch({ type: 'LOG_INTERACTION', interaction })}
          isAuto
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
            dispatch({ type: 'LOG_INTERACTION', interaction })
            setShowManualLog(false)
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
