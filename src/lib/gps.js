/**
 * GPS Tracking Service
 * Manages continuous location tracking during a canvassing session.
 * Batches GPS points and flushes to Supabase every 30 seconds.
 */

import { insertGpsPoints } from './supabase.js'

const GPS_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 3000,   // accept cached position up to 3s old (tightened from 5s)
}

// Discard any reading with accuracy worse than this (meters).
// 50m is intentionally generous — it filters GPS "jumps" (e.g. sudden 200m
// teleports when switching from cell-tower to GPS fix) without dropping
// legitimate readings in tree-heavy or urban environments.
const MAX_ACCURACY_M = 50

const FLUSH_INTERVAL_MS = 30_000   // flush buffer to DB every 30s
const TRACK_INTERVAL_MS = 5_000    // target a new position every 5s

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
  }

  start({ sessionId, repId, onPosition, onError }) {
    if (this.isTracking) this.stop()

    this.sessionId  = sessionId
    this.repId      = repId
    this.onPosition = onPosition
    this.onError    = onError
    this.isTracking = true
    this.pointBuffer = []

    if (!('geolocation' in navigator)) {
      onError?.(new Error('Geolocation is not supported on this device.'))
      return false
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handlePosition(pos),
      (err) => this._handleError(err),
      GPS_OPTIONS
    )

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

  getLastPosition() {
    return this.lastPosition
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
    const batch = this.pointBuffer.splice(0)
    try {
      await insertGpsPoints(batch)
    } catch (e) {
      // Re-add failed points to the front of the buffer
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
