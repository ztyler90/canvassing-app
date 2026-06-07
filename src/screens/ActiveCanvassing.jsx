import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { Square, MapPin, Clock, Home, Pin, Signal } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useSession } from '../contexts/SessionContext.jsx'
import { gpsTracker } from '../lib/gps.js'
import { endSession, updateSessionStats, getRepTerritories, getDoNotKnockList, upsertRepLocation, clearRepLocation, fireWebhookEvent, getOrgRecentInteractions, getRepSessions, getMyCommissionConfig, getMyOrganization, deleteInteraction } from '../lib/supabase.js'
import { isCommissionEnabled } from '../lib/tier.js'
import { acquireWakeLock, releaseWakeLock, isWakeLockSupported } from '../lib/wakeLock.js'
import { dnkZones, pointInAnyZone, loadDnkZones } from '../lib/dnk.js'
import { bucketIntoCells, filterByWindow, HEATMAP_COLORS } from '../lib/heatmap.js'
import {
  computeXP, computeLevel, computePeriodStats,
  calcCommission, describeCommission,
} from '../lib/repStats.js'
import MapView from '../components/MapView.jsx'
import InteractionModal from '../components/InteractionModal.jsx'
import InSessionChatBubble from '../components/InSessionChatBubble.jsx'

// Undo-knock toast — visible for 10s on every auto-detected knock so a
// rep who got a false-positive can one-tap the door (and its gray pin)
// back off. Tapping the toast body just dismisses it; only the explicit
// "Undo" button reverses the knock.
const UNDO_TOAST_MS = 10_000

// Short buzz on auto-knock detection. 80ms is long enough to feel
// through a pants-pocket phone without sounding like an alert. We only
// fire it for auto-detected knocks — manual logs aren't surprises.
const KNOCK_HAPTIC_MS = 80

// ── Inactivity auto-end ─────────────────────────────────────────────────
// Privacy guardrail: a session whose tab is open but seeing no GPS or
// interactions is almost certainly a rep who has finished canvassing and
// forgotten to tap "End Session". Without this, location tracking would
// continue indefinitely and managers would see a stale live pin. We warn
// at 50 minutes and auto-end at 60. Server-side belt-and-suspenders for
// the closed-tab case lives in supabase/migrations/
// 20260529_auto_close_idle_sessions.sql.
const IDLE_WARN_MS = 50 * 60 * 1000
const IDLE_STOP_MS = 60 * 60 * 1000

const BRAND_GREEN = '#1B4FCC'  // KnockIQ blue

export default function ActiveCanvassing() {
  const { user }                    = useAuth()
  const { state, dispatch, doorKnockRef } = useSession()
  const navigate                    = useNavigate()

  const [elapsed, setElapsed]       = useState(0)   // seconds
  const [stopping, setStopping]     = useState(false)
  const [showManualLog, setShowManualLog] = useState(false)
  const [editingInteraction, setEditingInteraction] = useState(null)
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

  // Inactivity auto-end state. See IDLE_WARN_MS / IDLE_STOP_MS above.
  // lastActivityRef holds the last time a gps point or interaction landed;
  // handleStopRef holds a stable reference to handleStop so the interval
  // doesn't need to re-subscribe whenever handleStop's closure changes.
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const lastActivityRef             = useRef(Date.now())
  const handleStopRef               = useRef(null)
  const autoEndingRef               = useRef(false)

  // Rep history powering the in-header XP bar + revenue sparkline, and
  // the rep's commission config (used to show live commission earned).
  // Fetched once on mount — the values only shift after a session ends,
  // so there's no need to re-poll during an active shift.
  const [pastSessions, setPastSessions] = useState([])
  const [commissionCfg, setCommissionCfg] = useState(null)
  const [org, setOrg] = useState(null)
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const [sess, cfg, myOrg] = await Promise.all([
          getRepSessions(user.id, 50),
          getMyCommissionConfig(),
          getMyOrganization(),
        ])
        if (cancelled) return
        setPastSessions(sess || [])
        setCommissionCfg(cfg)
        setOrg(myOrg)
      } catch {
        // Soft-fail: the header still shows reasonable zero-state values
        // so a flaky network doesn't block the rep from canvassing.
      }
    })()
    return () => { cancelled = true }
  }, [user?.id])

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
  // pull up to 30d of ORG-WIDE history once per session and filter
  // client-side as the rep flips the window selector. Team-wide coverage
  // lets a rep see where a teammate was yesterday so they don't
  // double-knock a block.
  const [heatmapOn, setHeatmapOn]         = useState(false)
  const [heatmapWindow, setHeatmapWindow] = useState(7)     // 7 | 30 days
  const [heatmapRows, setHeatmapRows]     = useState([])
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  useEffect(() => {
    if (!heatmapOn || !user?.id || heatmapRows.length) return
    setHeatmapLoading(true)
    getOrgRecentInteractions(30)
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

  // ── Live XP + commission + revenue widgets ─────────────────────────
  // Baseline = lifetime XP across submitted sessions. Active session XP
  // is added on top so the bar actually moves as the rep knocks doors /
  // books jobs. computeXP normalizes estimates to at least `bookings`
  // to match the same rule computePeriodStats applies to history — keeps
  // the in-session XP consistent with what the home screen shows.
  const lifetimeXPBase = computeXP(computePeriodStats(pastSessions).lifetime)
  const sessionXP      = computeXP({
    doors:         state.stats.doors,
    conversations: state.stats.conversations,
    estimates:     Math.max(state.stats.estimates || 0, state.stats.bookings || 0),
    bookings:      state.stats.bookings,
    revenue:       state.stats.revenue,
  })
  const levelInfo = computeLevel(lifetimeXPBase + sessionXP)
  // Commission dollars earned so far in this session (per manager config).
  // Only shown when the org has the Pro commission add-on enabled.
  const commissionOn = isCommissionEnabled(org)
  const sessionCommission = calcCommission(
    { revenue: state.stats.revenue, bookings: state.stats.bookings },
    commissionCfg,
  )
  // ── Daily goal meter ──────────────────────────────────────────────
  // Replaces the old 7-day revenue sparkline as the rep's key at-a-glance
  // number. Combines sessions already submitted today with the live
  // session in progress so the meter fills in real time as the rep books
  // work. Metric (revenue $ vs. estimate/appointment count) and target
  // come from the manager-set daily goal in Settings, mirroring the same
  // logic RepHome uses for its goal pace card.
  const isRevenueGoal = (org?.daily_goal_type || 'revenue') === 'revenue'
  const goalTarget    = Number(org?.daily_goal_value) || 0
  const goalCountNoun = org?.count_goal_label === 'appointments' ? 'appointments' : 'estimates'
  const todayKey      = format(new Date(), 'yyyy-MM-dd')
  // Sessions already submitted today. The live session isn't in
  // pastSessions yet — its progress lives in state.stats and is added on
  // top below so the bar moves as the rep works.
  const earlierToday = (pastSessions || [])
    .filter((s) => typeof s.started_at === 'string' && s.started_at.startsWith(todayKey))
    .reduce(
      (acc, s) => ({
        revenue:   acc.revenue   + (Number(s.revenue_booked) || 0),
        estimates: acc.estimates + (s.estimates || 0),
      }),
      { revenue: 0, estimates: 0 },
    )
  const goalCurrent = isRevenueGoal
    ? earlierToday.revenue   + (state.stats.revenue   || 0)
    : earlierToday.estimates + (state.stats.estimates || 0)
  // Fallback for orgs with no manager-set goal: the rep can't set one
  // themselves, so rather than nag them we show the original 7-day
  // revenue sparkline. Oldest → newest, capped at 7 for readability.
  const last7 = [...(pastSessions || [])].slice(0, 7).reverse()

  const handleStop = async () => {
    // Idempotency guard — the inactivity timer can race the manual button;
    // either one calls in here and the other is a no-op.
    if (stopping || autoEndingRef.current) return
    autoEndingRef.current = true
    setStopping(true)
    setShowIdleWarning(false)

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

    // Fire the org-level Zapier webhook (gated by the 'session_ended' toggle)
    try {
      await fireWebhookEvent('session_ended', {
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
    } catch (e) {
      console.warn('[Webhook] Error firing webhook:', e)
    }

    navigate('/summary', { replace: true })
  }

  // Keep a stable ref to handleStop so the inactivity interval doesn't
  // re-subscribe on every render.
  handleStopRef.current = handleStop

  // Reset the activity stamp every time a new gps point or interaction
  // lands. Either signal means the rep is still working.
  useEffect(() => {
    lastActivityRef.current = Date.now()
    // If a previously-displayed warning was up, dismiss it — the rep is
    // clearly active again.
    if (showIdleWarning) setShowIdleWarning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.gpsTrail.length, state.interactions.length])

  // Poll every 30s while the session is running. At 50 min of inactivity
  // we surface the "Are you still canvassing?" modal; at 60 min we auto-
  // end via handleStop. The server-side sweep (auto_close_idle_sessions)
  // catches the case where the rep closed the tab without responding.
  useEffect(() => {
    if (!state.isRunning) return
    const id = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current
      if (idleMs >= IDLE_STOP_MS) {
        handleStopRef.current?.()
      } else if (idleMs >= IDLE_WARN_MS) {
        setShowIdleWarning(true)
      }
    }, 30_000)
    return () => clearInterval(id)
  }, [state.isRunning])

  // "I'm still canvassing" — resets the activity clock without ending.
  const handleStayActive = () => {
    lastActivityRef.current = Date.now()
    setShowIdleWarning(false)
  }

  // Auto-prompt when a door knock is detected
  const pendingKnock = state.pendingKnock

  // Fire the haptic + open the undo toast the moment a fresh knock is
  // detected. We gate on the interaction `id` so we don't re-fire if the
  // reducer replays the same pendingKnock (e.g. during a hydrate).
  const lastHapticForRef = useRef(null)
  useEffect(() => {
    if (!pendingKnock) return
    const key = pendingKnock.id || `${pendingKnock.lat},${pendingKnock.lng}`
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

  return (
    <div className="flex flex-col bg-gray-100 overflow-hidden" style={{ height: '100dvh' }}>

      {/* Top Stats Bar + in-header XP progress. Wrapping in a column
          lets us stack the scoreboard row above a compact level/XP bar
          without disturbing existing spacing. Yellow XP fill pops nicely
          against the BRAND_GREEN header. */}
      <div className="px-4 pt-3 pb-3 shadow-sm z-10"
        style={{ backgroundColor: BRAND_GREEN }}>
        <div className="flex items-center justify-between">
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

        {/* Live XP bar — progress toward the next level, including XP
            earned so far in the current session. "+N this session"
            teases real-time progress so the rep sees the bar tick up
            with every logged knock / booking. */}
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between text-white mb-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] leading-none" aria-hidden="true">{levelInfo.icon}</span>
              <span className="text-[10px] font-bold tracking-wider uppercase text-blue-100 truncate">
                Lvl {levelInfo.level} · {levelInfo.title}
              </span>
            </div>
            <div className="text-[10px] text-blue-100 font-medium tabular-nums flex items-baseline gap-2">
              <span>
                <span className="text-white font-bold">{levelInfo.xpIntoLevel.toLocaleString()}</span>
                <span className="text-blue-300"> / {levelInfo.xpForNext.toLocaleString()} XP</span>
              </span>
              {sessionXP > 0 && (
                <span className="font-bold" style={{ color: '#FACC15' }}>+{sessionXP.toLocaleString()}</span>
              )}
            </div>
          </div>
          <div className="h-[5px] bg-white/15 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.round(levelInfo.progress * 100)}%`,
                background: 'linear-gradient(90deg, #FACC15 0%, #F59E0B 100%)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Commission earned this session + daily goal meter.
          Two compact micro-widgets between the header and the existing
          secondary stats row. Both are read-only at-a-glance signals so
          the rep doesn't lose focus from knocking. */}
      <div className={`bg-white border-b grid divide-x divide-gray-100 ${commissionOn ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {commissionOn && <CommissionChip amount={sessionCommission} config={commissionCfg} />}
        {goalTarget > 0 ? (
          <DailyGoalMeter
            current={goalCurrent}
            target={goalTarget}
            isRevenue={isRevenueGoal}
            countNoun={goalCountNoun}
          />
        ) : (
          <RevenueSparkline sessions={last7} />
        )}
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

        {/* Wake-lock advisory — appears if the device tab was backgrounded.
            The whole banner is tappable to dismiss: the corner × can be
            covered by the Team Coverage pill, so tapping anywhere closes it. */}
        {showWakeWarning && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setShowWakeWarning(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowWakeWarning(false) } }}
            aria-label="Dismiss screen-open notice"
            className="absolute top-3 right-3 left-3 sm:left-auto sm:max-w-xs bg-amber-50 border border-amber-300 text-amber-800 rounded-xl px-3 py-2 shadow-lg text-xs flex items-start gap-2 cursor-pointer transition-opacity active:opacity-0 hover:bg-amber-100"
          >
            <span>⚠️</span>
            <div className="flex-1">
              <p className="font-semibold">Keep this screen open</p>
              <p className="mt-0.5 leading-snug">
                GPS pauses when the phone locks or the browser is in the
                background. For pocket tracking, install the native app.
              </p>
              <p className="mt-1 font-medium text-amber-600">Tap to dismiss</p>
            </div>
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
        Door-knock UX. A detected knock immediately drops a gray "No Answer"
        pin on the map (persisted by the detector) and surfaces the undo
        toast below — no separate "Log this door" pill. To record that
        someone actually answered, the rep taps the door's pin on the map,
        which opens the edit modal on that same row (the "upgrade" path).
        10-second undo toast. Floats at the bottom just above the action bar.
        Tapping the toast body dismisses it (the door stays logged as a
        no-answer); only the "Undo" button reverses the knock — it removes
        the gray pin, deletes the row, and decrements the door count.
      */}
      {knockToast && (
        <UndoKnockToast
          durationMs={UNDO_TOAST_MS}
          onUndo={() => {
            const undoId = knockToast.id
            dispatch({ type: 'UNDO_LAST_KNOCK', id: undoId })
            // Best-effort DB cleanup for the auto-created no_answer row.
            // Skip client-only fallback rows (offline) — they were never saved.
            if (undoId && !knockToast._localOnly) {
              deleteInteraction(undoId).catch(() => {})
            }
            setKnockToast(null)
          }}
          onDismiss={() => setKnockToast(null)}
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

      {/* Inactivity warning — surfaces at 50min of no GPS / interactions.
          If the rep ignores it, the polling effect calls handleStop() at
          60min. Server-side sweep catches the closed-tab case. */}
      {showIdleWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Still canvassing?</h3>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              We haven't seen any door logs or movement in a while. Your
              session will auto-end in 10 minutes to keep your location
              private once you've stopped working.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleStop}
                disabled={stopping}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm disabled:opacity-60"
              >
                End now
              </button>
              <button
                onClick={handleStayActive}
                className="flex-1 py-2.5 rounded-xl text-white font-semibold text-sm"
                style={{ backgroundColor: BRAND_GREEN }}
              >
                I'm still here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-session chat bubble — floats over the layout in the lower-right,
          completely independent of the session lifecycle. Tapping it
          neither pauses GPS, ends the session, nor interrupts the door-
          knock detector; it just overlays a compact ChatPanel. */}
      <InSessionChatBubble />
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
 * CommissionChip
 * ──────────────
 * In-header widget that shows the rep's commission earned so far this
 * session, along with a one-line description of the comp plan so the
 * number has context. Uses the existing describeCommission helper to
 * render "15% of revenue" / "$75 per booking" / "Tiered: …" so the rep
 * knows where the $ number comes from without opening Settings.
 */
function CommissionChip({ amount, config }) {
  const desc = describeCommission(config || null)
  return (
    <div className="px-3 py-2 flex items-center gap-2 min-w-0">
      <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center text-[13px] flex-shrink-0" aria-hidden="true">💰</div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold leading-none mb-0.5">Commission</p>
        <p className="text-base font-bold text-emerald-600 leading-tight tabular-nums">${Number(amount || 0).toFixed(0)}</p>
        <p className="text-[10px] text-gray-400 truncate leading-tight">{desc}</p>
      </div>
    </div>
  )
}

/**
 * DailyGoalMeter
 * ──────────────
 * Replaces the old 7-day revenue sparkline as the rep's key number when
 * the manager has set a daily goal. Shows progress toward that goal
 * (revenue $ or estimate/appointment count) as a "current / target"
 * headline plus a progress bar that fills in real time — earlier-today
 * sessions plus the live one. Once the goal is hit the bar turns a
 * brighter green and the icon flips to a ✅ so the win is unmistakable.
 * When no goal is configured the caller renders <RevenueSparkline>
 * instead (the rep can't set a goal themselves, so we don't nag them).
 */
function DailyGoalMeter({ current = 0, target = 0, isRevenue = true, countNoun = 'estimates' }) {
  const fmt = (n) =>
    isRevenue
      ? `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `${Number(n || 0)}`

  const pct       = Math.min((current / target) * 100, 100)
  const hit       = current >= target
  const remaining = Math.max(0, target - current)
  const fill      = hit ? '#16A34A' : BRAND_GREEN
  return (
    <div className="px-3 py-2 flex items-center gap-2 min-w-0">
      <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 grid place-items-center text-[13px] flex-shrink-0" aria-hidden="true">{hit ? '✅' : '🎯'}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold leading-none mb-0.5">
          Daily goal{!isRevenue ? ` · ${countNoun}` : ''}
        </p>
        <p className="text-base font-bold text-gray-900 leading-tight tabular-nums">
          {fmt(current)}<span className="text-gray-400 font-medium"> / {fmt(target)}</span>
        </p>
        <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, backgroundColor: fill }}
          />
        </div>
        <p className="text-[10px] text-gray-400 truncate leading-tight mt-0.5">
          {hit ? 'Goal hit — keep going! 🔥' : `${fmt(remaining)} to go`}
        </p>
      </div>
    </div>
  )
}

/**
 * RevenueSparkline
 * ────────────────
 * Fallback widget shown when the org has no manager-set daily goal. Tiny
 * bar chart of the rep's last N submitted sessions' revenue, chronological
 * (oldest → newest, left → right). The total is the headline number so a
 * glance conveys "how much have I booked recently" without decoding the
 * bars. Empty bars render gray so an inactive stretch is obvious.
 */
function RevenueSparkline({ sessions = [] }) {
  const revs = sessions.map((s) => Number(s.revenue_booked) || 0)
  // Max governs bar height so a $200 day doesn't dwarf the whole chart
  // next to a $3000 day. Floor at 1 so we never divide by zero.
  const max   = Math.max(1, ...revs)
  const total = revs.reduce((a, b) => a + b, 0)
  // Always render 7 slots so a new rep sees the full chart shape even
  // before they have 7 sessions — empty slots read as "room to grow".
  const slots = Array.from({ length: 7 }, (_, i) => revs[i] ?? 0)
  const count = revs.length
  return (
    <div className="px-3 py-2 flex items-center gap-2 min-w-0">
      <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 grid place-items-center text-[13px] flex-shrink-0" aria-hidden="true">📈</div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-bold leading-none mb-0.5">
          Revenue · last {count || 7}
        </p>
        <p className="text-base font-bold text-gray-900 leading-tight tabular-nums">${total.toFixed(0)}</p>
        <div className="flex items-end gap-[2px] h-3.5 mt-0.5" aria-hidden="true">
          {slots.map((r, i) => (
            <div
              key={i}
              className="flex-1 rounded-[2px]"
              style={{
                height: `${Math.max(12, (r / max) * 100)}%`,
                backgroundColor: r > 0 ? BRAND_GREEN : '#E5E7EB',
                minWidth: '3px',
              }}
              title={`$${Number(r).toFixed(0)}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * HeatmapControl
 * ──────────────
 * Compact top-right control with a toggle button and two radio chips
 * for the lookback window (7d / 30d). When the toggle is off we hide
 * the chips entirely — a rep who doesn't want the heatmap shouldn't
 * see clutter.
 *
 * Shows org-wide coverage: any rep at the same company, not just the
 * caller. Lets a rep avoid double-knocking a block a teammate just hit.
 *
 * Cells are still shaded by recency (≤24h / ≤7d / ≤30d) within the
 * chosen lookback — the shading teaches the "hot → cold" scale.
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
        Team Coverage{loading ? '…' : ''}
      </button>
      {on && (
        <div className="bg-white/95 backdrop-blur rounded-full shadow flex text-[11px] font-semibold overflow-hidden">
          {[
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
  // Tapping anywhere on the toast body dismisses it (the door stays logged
  // as a no-answer). The "Undo" button is the ONLY way to reverse the knock,
  // so it stops propagation to avoid also firing the body's dismiss.
  return (
    <div className="absolute bottom-20 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[380px] z-30 pointer-events-none">
      <div
        onClick={onDismiss}
        role="button"
        tabIndex={0}
        aria-label="Dismiss"
        className="bg-gray-900/95 backdrop-blur text-white rounded-2xl shadow-2xl px-3.5 py-3 flex items-center gap-3 pointer-events-auto cursor-pointer active:opacity-90"
      >
        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
          <Pin className="w-4 h-4 text-blue-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Knock detected</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Counted as a door — tap to dismiss</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onUndo() }}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-900 bg-white active:opacity-80 shrink-0"
        >
          Undo
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
