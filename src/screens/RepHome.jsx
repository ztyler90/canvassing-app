import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, formatDistanceToNow } from 'date-fns'
import { MapPin, Clock, DollarSign, Target, ChevronRight, LogOut, Settings } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import { startSession, getRepSessions, getActiveSession, signOut, updateSessionStats } from '../lib/supabase.js'
import { requestGPSPermission } from '../lib/gps.js'
import { gpsTracker } from '../lib/gps.js'
import { DoorKnockDetector } from '../lib/doorKnock.js'

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue
const BRAND_LIME  = '#7DC31E'  // KnockIQ lime (accent)
const DAILY_GOAL  = 1000

export default function RepHome() {
  const { user, refreshUser } = useAuth()
  const { state, dispatch, doorKnockRef } = useSession()
  const navigate = useNavigate()

  const [pastSessions, setPastSessions]   = useState([])
  const [loadingStart, setLoadingStart]   = useState(false)
  const [gpsError, setGpsError]           = useState('')
  const [todayRevenue, setTodayRevenue]   = useState(0)
  const [todayDoors, setTodayDoors]       = useState(0)

  useEffect(() => {
    loadHistory()
    checkActiveSession()
  }, [])

  async function loadHistory() {
    const sessions = await getRepSessions(user.id, 10)
    setPastSessions(sessions)
    const today = format(new Date(), 'yyyy-MM-dd')
    const todaySessions = sessions.filter(s => s.started_at.startsWith(today))
    setTodayRevenue(todaySessions.reduce((sum, s) => sum + (s.revenue_booked || 0), 0))
    setTodayDoors(todaySessions.reduce((sum, s) => sum + (s.doors_knocked || 0), 0))
  }

  async function checkActiveSession() {
    const existing = await getActiveSession(user.id)
    if (existing) {
      // Resume session that was left active
      dispatch({ type: 'START_SESSION', session: existing })
      startGPS(existing)
      navigate('/canvassing')
    }
  }

  const handleStartCanvassing = async () => {
    setGpsError('')
    setLoadingStart(true)
    try {
      await requestGPSPermission()
    } catch (err) {
      setGpsError('GPS access is required to canvass. Please enable location permissions and try again.')
      setLoadingStart(false)
      return
    }

    const { data: session, error } = await startSession(user.id)
    if (error) { setGpsError(error.message); setLoadingStart(false); return }

    dispatch({ type: 'START_SESSION', session })
    startGPS(session)
    setLoadingStart(false)
    navigate('/canvassing')
  }

  function startGPS(session) {
    const detector = new DoorKnockDetector({
      repId: user.id,
      onKnock: (knock) => {
        dispatch({ type: 'SET_PENDING_KNOCK', knock })
      },
    })
    doorKnockRef.current = detector

    gpsTracker.start({
      sessionId: session.id,
      repId:     user.id,
      onPosition: async (point) => {
        dispatch({ type: 'ADD_GPS_POINT', point })
        await detector.feed(point)
        // Keep session stats fresh in the DB periodically
        await updateSessionStats(session.id, {
          doors_knocked:  state.stats.doors,
          conversations:  state.stats.conversations,
          estimates:      state.stats.estimates,
          bookings:       state.stats.bookings,
          revenue_booked: state.stats.revenue,
        })
      },
      onError: (err) => console.warn('[GPS]', err),
    })
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const goalPct = Math.min((todayRevenue / DAILY_GOAL) * 100, 100)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-5" style={{ backgroundColor: BRAND_GREEN }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-blue-200 text-sm">Welcome back</p>
            <h1 className="text-white text-xl font-bold">{user?.full_name || 'Rep'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/profile')} className="p-2 rounded-full bg-white/20">
              <Settings className="w-5 h-5 text-white" />
            </button>
            <button onClick={handleSignOut} className="p-2 rounded-full bg-white/20">
              <LogOut className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Today's Goal Progress */}
        <div className="bg-white/15 rounded-2xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-white font-semibold text-sm">Today's Goal</span>
            <span className="text-white font-bold">
              ${todayRevenue.toFixed(0)} <span className="text-blue-200 font-normal">/ $1,000</span>
            </span>
          </div>
          <div className="h-2.5 bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${goalPct}%`, backgroundColor: goalPct >= 100 ? '#FFD700' : '#86EFAC' }}
            />
          </div>
          {todayDoors > 0 && (
            <p className="text-blue-200 text-xs mt-2">{todayDoors} doors knocked today</p>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-5 pt-6 pb-8 space-y-5">
        {/* Start Button */}
        <button
          onClick={handleStartCanvassing}
          disabled={loadingStart}
          className="w-full py-5 rounded-2xl text-white text-xl font-bold shadow-lg active:scale-95 transition-transform disabled:opacity-70"
          style={{ backgroundColor: BRAND_GREEN }}
        >
          {loadingStart ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Getting GPS…
            </span>
          ) : '▶  Start Canvassing'}
        </button>

        {gpsError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
            {gpsError}
          </div>
        )}

        {/* Today's Stats */}
        {todayDoors > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={<MapPin className="w-5 h-5" />} label="Doors Today" value={todayDoors} color="blue" />
            <StatCard icon={<DollarSign className="w-5 h-5" />} label="Revenue Today" value={`$${todayRevenue.toFixed(0)}`} color="green" />
          </div>
        )}

        {/* Recent Sessions */}
        {pastSessions.length > 0 && (
          <div>
            <h2 className="text-gray-700 font-semibold text-base mb-3">Recent Sessions</h2>
            <div className="space-y-2">
              {pastSessions.slice(0, 5).map((s) => (
                <SessionRow key={s.id} session={s} onClick={() => navigate('/session/' + s.id)} />
              ))}
            </div>
          </div>
        )}

        {pastSessions.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MapPin className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No sessions yet</p>
            <p className="text-sm mt-1">Hit Start Canvassing to begin your first session.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  const colors = {
    blue:  { bg: 'bg-blue-50',  text: 'text-blue-600'  },
    green: { bg: 'bg-green-50', text: 'text-green-700' },
  }
  const c = colors[color] || colors.blue
  return (
    <div className={`${c.bg} rounded-xl p-4`}>
      <div className={`${c.text} mb-1`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function SessionRow({ session, onClick }) {
  const elapsed = session.ended_at
    ? ((new Date(session.ended_at) - new Date(session.started_at)) / 60000).toFixed(0)
    : null

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl px-4 py-3 flex items-center justify-between shadow-sm active:bg-gray-50 text-left">
      <div>
        <p className="font-medium text-gray-900 text-sm">
          {format(new Date(session.started_at), 'EEE, MMM d')}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {session.doors_knocked} doors · {elapsed ? `${elapsed} min` : '—'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="font-bold text-gray-900">${(session.revenue_booked || 0).toFixed(0)}</p>
          <p className="text-xs text-green-600">{session.bookings || 0} booked</p>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
      </div>
    </button>
  )
}
