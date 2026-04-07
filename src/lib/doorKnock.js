/**
 * Door Knock Detection Algorithm
 *
 * A "door knock" is registered when a rep:
 *   1. Stops within STOP_RADIUS_M meters of a position
 *   2. Remains there for MIN_STOP_SECS – MAX_STOP_SECS seconds
 *   3. The resolved address hasn't been logged in the last 24 hours
 *
 * Usage:
 *   const detector = new DoorKnockDetector({ onKnock: ({ lat, lng, address }) => ... })
 *   detector.feed(gpsPoint)      // call for each new GPS point
 *   detector.reset()             // call when session ends
 */

import { reverseGeocode } from './geocoding.js'
import { distanceMeters }  from './gps.js'
import { wasAddressRecentlyVisited } from './supabase.js'

const STOP_RADIUS_M  = 15    // ~50 ft — must stay within this radius to count as stopped
const MIN_STOP_SECS  = 20    // minimum seconds to count as a stop
const MAX_STOP_SECS  = 120   // maximum — longer means they're inside, not at the door
const MIN_MOVE_M     = 8     // must move this far to "leave" a stop zone

export class DoorKnockDetector {
  /**
   * @param {object} opts
   * @param {function} opts.onKnock - async (knockData) => void
   * @param {string}   opts.repId
   */
  constructor({ onKnock, repId }) {
    this.onKnock     = onKnock
    this.repId       = repId
    this.stopOrigin  = null   // { lat, lng, startedAt }
    this.lastPoint   = null
    this.pending     = false  // waiting for geocode + DB check
    this.recentKnocks = new Map()  // address -> timestamp (in-memory dedup)
  }

  async feed(point) {
    if (!point || this.pending) return

    const now = Date.now()

    if (!this.stopOrigin) {
      // Start tracking a potential stop
      this.stopOrigin = { lat: point.lat, lng: point.lng, startedAt: now }
      this.lastPoint  = point
      return
    }

    const dist    = distanceMeters(this.stopOrigin, point)
    const elapsed = (now - this.stopOrigin.startedAt) / 1000  // seconds

    if (dist > MIN_MOVE_M) {
      // Moved away — reset stop origin
      if (elapsed >= MIN_STOP_SECS && elapsed <= MAX_STOP_SECS) {
        // Valid stop duration — trigger knock detection
        await this._tryKnock(this.stopOrigin, elapsed)
      }
      this.stopOrigin = { lat: point.lat, lng: point.lng, startedAt: now }
    } else if (elapsed > MAX_STOP_SECS) {
      // Stopped too long (>2 min) — they're probably inside. Reset.
      this.stopOrigin = null
    }

    this.lastPoint = point
  }

  async _tryKnock(origin, elapsedSecs) {
    this.pending = true
    try {
      const address = await reverseGeocode(origin.lat, origin.lng)
      if (!address) { this.pending = false; return }

      // Check in-memory cache first (fast dedup)
      const lastVisit = this.recentKnocks.get(address)
      if (lastVisit && (Date.now() - lastVisit) < 24 * 3600 * 1000) {
        this.pending = false
        return
      }

      // Check DB (cross-session dedup)
      const alreadyVisited = await wasAddressRecentlyVisited(address, this.repId)
      if (alreadyVisited) {
        this.recentKnocks.set(address, Date.now())
        this.pending = false
        return
      }

      // Confirmed knock!
      this.recentKnocks.set(address, Date.now())
      this.onKnock?.({
        lat:         origin.lat,
        lng:         origin.lng,
        address,
        elapsedSecs: Math.round(elapsedSecs),
        knockedAt:   new Date().toISOString(),
      })
    } catch (e) {
      console.warn('[DoorKnock] Detection error:', e.message)
    } finally {
      this.pending = false
    }
  }

  reset() {
    this.stopOrigin = null
    this.lastPoint  = null
    this.pending    = false
  }
}
