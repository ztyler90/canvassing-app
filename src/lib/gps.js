/**
 * GPS Tracking Service
 * Manages continuous location tracking during a canvassing session.
 * Batches GPS points and flushes to Supabase every 30 seconds.
 *
 * v2 — adaptive polling
 * ─────────────────────
 * The watchPosition options used to be a single preset. In practice a
 * rep walking between houses doesn't need 5 s updates, and a rep
 * standing at a door needs higher accuracy for reverse-geocoding. We
 * now expose `setMode(mode)` which re-watches with mode-specific
 * options. The DoorKnockDetector calls this via its `onModeChange`
 * callback so the two systems stay in sync automatically.
 */

import { insertGpsPoints } from './supabase.js'

// Discard any reading with accuracy worse than this (meters).
// 50m is intentionally generous — it filters GPS "jumps" (e.g. sudden 200m
// teleports when switching from cell-tower to GPS fix) without dropping
// legitimate readings in tree-heavy or urban environments.
const MAX_ACCURACY_M = 50

const FLUSH_INTERVAL_MS = 30_000   // flush buffer to DB every 30s

// Mode-specific GPS options. Trading battery for freshness:
//   moving  — steady walk, jogging between streets. Accept slightly stale
//             readings, don't need hyper-precision.
//   stopped — rep is at a door. Highest accuracy, fresh readings.
//   idle    — session running but the rep hasn't moved much and no
//             knock is pending (e.g. sitting in car briefly). Throttle.
const GPS_MODES = {
  moving: {
    enableHighAccuracy: true,
    timeout:            15000,
    maximumAge:         3000,
  },
  stopped: {
    enableHighAccuracy: true,
    timeout:            10000,
    maximumAge:         1000,   // insist on fresh fixes for address accuracy
  },
  idle: {
    enableHighAccuracy: false,  // coarse location is fine; saves battery
    timeout:            20000,
    maximumAge:         10000,
  },
}

class GPSTracker {
  constructor() {
    this.watchId       = null
    this.flushTimer    = null
    this.pointBuffer   = []
    this.sessionId     = null
    this.repId         = null
    this.lastPosition  = null
    this.onPosition    = null   // callback(position)
    this.onError       = null   // callback(error)
    this.isTracking    = false
    this.mode          = 'moving'
  }

  start({ sessionId, repId, onPosition, onError }) {
    if (this.isTracking) this.stop()

    this.sessionId  = sessionId
    this.repId      = repId
    this.onPosition = onPosition
    this.onError    = onError
    this.isTracking = true
    this.pointBuffer = []
    this.mode       = 'moving'

    if (!('geolocation' in navigator)) {
      onError?.(new Error('Geolocation is not supported on this device.'))
      return false
    }

    this._installWatch()
    this.flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS)
    return true
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this._flush()   // final flush
    this.isTracking = false
  }

  /**
   * Switch GPS polling mode. No-op if the mode hasn't changed; otherwise
   * clears and re-installs the watchPosition handler with the new options.
   * We tolerate a brief gap (one-frame) between clearWatch and
   * watchPosition — typical devices immediately deliver a cached fix.
   */
  setMode(mode) {
    if (!GPS_MODES[mode]) return
    if (!this.isTracking) { this.mode = mode; return }
    if (this.mode === mode) return
    this.mode = mode
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
    this._installWatch()
  }

  getLastPosition() {
    return this.lastPosition
  }

  _installWatch() {
    const opts = GPS_MODES[this.mode] || GPS_MODES.moving
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handlePosition(pos),
      (err) => this._handleError(err),
      opts
    )
  }

  _handlePosition(pos) {
    // Discard low-accuracy readings (GPS "jumps" during cell-tower→GPS transitions)
    if (pos.coords.accuracy > MAX_ACCURACY_M) {
      console.debug(`[GPS] Discarding low-accuracy reading: ${pos.coords.accuracy.toFixed(0)}m`)
      return
    }

    const point = {
      session_id:  this.sessionId,
      rep_id:      this.repId,
      lat:         pos.coords.latitude,
      lng:         pos.coords.longitude,
      accuracy:    pos.coords.accuracy,
      speed:       pos.coords.speed,
      // `heading` is reported in degrees (0–359, 0=North). May be null
      // when the device is stationary. The door-knock detector uses it
      // to confirm "turn toward a door" before firing a knock.
      heading:     pos.coords.heading,
      recorded_at: new Date(pos.timestamp).toISOString(),
    }

    this.lastPosition = point
    this.pointBuffer.push(point)
    this.onPosition?.(point)

    if (this.pointBuffer.length >= 20) this._flush()
  }

  _handleError(err) {
    console.warn('[GPS] Error:', err.message)
    this.onError?.(err)
  }

  async _flush() {
    if (!this.pointBuffer.length) return
    // Only send DB-column fields — `heading` is purely a client-side
    // signal for the detector, not stored in the gps_points table.
    const batch = this.pointBuffer.splice(0).map(({ heading, ...rest }) => rest)
    try {
      await insertGpsPoints(batch)
    } catch (e) {
      // Re-add failed points to the front of the buffer (with heading stripped
      // — we've already dropped it for the failed send, no need to keep it).
      this.pointBuffer.unshift(...batch)
      console.warn('[GPS] Flush failed, will retry:', e.message)
    }
  }
}

export const gpsTracker = new GPSTracker()

// One-shot permission check
export function requestGPSPermission() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 10000, enableHighAccuracy: true }
    )
  })
}

// Haversine distance in meters between two {lat, lng} points
export function distanceMeters(a, b) {
  const R  = 6371000
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const x  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
