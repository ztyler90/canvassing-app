/**
 * Door Knock Detection Algorithm  (v2 — loosened & resilient)
 *
 * A "door knock" is registered when a rep:
 *   1. Stops within STOP_RADIUS_M meters of a position
 *   2. Remains there for at least MIN_STOP_SECS seconds (4 s)
 *   3. The resolved address hasn't been logged in the last 24 hours
 *
 * Key v2 changes
 * ─────────────
 * • Knock fires **proactively** when the dwell threshold is met,
 *   not only when the rep walks away.
 * • GPS jitter compensation — uses the position accuracy value
 *   so that a 6 m "jump" on a phone with 12 m accuracy is treated
 *   as noise rather than real movement.
 * • feed() is never blocked — the old `pending` flag silently
 *   dropped GPS points during geocoding, causing missed knocks.
 * • The centroid of all GPS points captured during a stop is used
 *   for reverse-geocoding (more accurate than a single reading).
 * • Knocks still fire when address is null — the user can fill it
 *   in manually via the InteractionModal.
 */

import { reverseGeocode } from './geocoding.js'
import { distanceMeters }  from './gps.js'
import { wasAddressRecentlyVisited } from './supabase.js'

// ── Thresholds ──────────────────────────────────────────────────
const STOP_RADIUS_M      = 15    // ~50 ft — max drift while "stopped"
const MIN_STOP_SECS      = 4     // seconds to qualify as a door knock
const AUTO_PROMPT_SECS   = 45    // auto-open modal (likely in conversation)
const MIN_MOVE_M         = 5     // metres to count as "left the stop"
const JITTER_FACTOR      = 0.5   // movement < accuracy × this → GPS noise

export class DoorKnockDetector {
  /**
   * @param {object} opts
   * @param {function} opts.onKnock - (knockData) => void
   *   knockData: { lat, lng, address, elapsedSecs, knockedAt, autoPrompt }
   * @param {string}   opts.repId
   */
  constructor({ onKnock, repId }) {
    this.onKnock       = onKnock
    this.repId         = repId
    this.stopOrigin    = null   // { lat, lng, startedAt }
    this.stopPoints    = []     // all { lat, lng } received during this stop
    this.lastPoint     = null
    this.knockFired    = false  // true once we've fired a knock for this stop
    this.longStopFired = false  // true once we've auto-prompted for this stop
    this.recentKnocks  = new Map()  // address → timestamp (in-memory dedup)
  }

  /**
   * Call for every incoming GPS point.
   * Never blocks — geocoding runs in the background.
   */
  feed(point) {
    if (!point) return

    const now      = Date.now()
    const accuracy = point.accuracy || 15

    // ── First point ever: start a potential stop ────────────
    if (!this.stopOrigin) {
      this.stopOrigin = { lat: point.lat, lng: point.lng, startedAt: now }
      this.stopPoints = [{ lat: point.lat, lng: point.lng }]
      this.lastPoint  = point
      return
    }

    const dist    = distanceMeters(this.stopOrigin, point)
    const elapsed = (now - this.stopOrigin.startedAt) / 1000

    // Effective movement threshold — account for GPS noise.
    // If the phone reports 12 m accuracy, a 5 m "move" is jitter.
    const moveThreshold = Math.max(MIN_MOVE_M, accuracy * JITTER_FACTOR)

    if (dist > moveThreshold && dist > STOP_RADIUS_M) {
      // ── Real movement — rep has left this spot ────────────
      // Fire a knock if they stayed long enough and we haven't already
      if (elapsed >= MIN_STOP_SECS && !this.knockFired) {
        this._tryKnock(elapsed, false)
      }
      // Reset for next potential stop
      this.stopOrigin    = { lat: point.lat, lng: point.lng, startedAt: now }
      this.stopPoints    = [{ lat: point.lat, lng: point.lng }]
      this.knockFired    = false
      this.longStopFired = false
    } else {
      // ── Still at the same spot ────────────────────────────
      this.stopPoints.push({ lat: point.lat, lng: point.lng })

      // Proactive knock: fire as soon as dwell threshold is met
      if (elapsed >= MIN_STOP_SECS && !this.knockFired) {
        this.knockFired = true
        this._tryKnock(elapsed, false)
      }

      // Auto-prompt for longer stops (rep is likely talking to someone)
      if (elapsed >= AUTO_PROMPT_SECS && !this.longStopFired) {
        this.longStopFired = true
        this._tryKnock(elapsed, true)
      }
    }

    this.lastPoint = point
  }

  // ── Private helpers ─────────────────────────────────────────

  /** Compute centroid of all GPS points captured during this stop.
   *  Averaging multiple readings is more accurate than any single one. */
  _centroid() {
    const n = this.stopPoints.length
    if (n === 0) return this.stopOrigin
    const sum = this.stopPoints.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
      { lat: 0, lng: 0 }
    )
    return { lat: sum.lat / n, lng: sum.lng / n }
  }

  /** Attempt to register a knock. Runs async but does NOT block feed(). */
  async _tryKnock(elapsedSecs, autoPrompt = false) {
    const center = this._centroid()
    try {
      const address = await reverseGeocode(center.lat, center.lng)

      // If we got an address, run dedup checks
      if (address) {
        // Fast in-memory dedup
        const lastVisit = this.recentKnocks.get(address)
        if (lastVisit && (Date.now() - lastVisit) < 24 * 3600 * 1000) return

        // Cross-session DB dedup
        const alreadyVisited = await wasAddressRecentlyVisited(address, this.repId)
        if (alreadyVisited) {
          this.recentKnocks.set(address, Date.now())
          return
        }
        this.recentKnocks.set(address, Date.now())
      }

      // Fire the knock — address may be null; user can fill it in manually
      this.onKnock?.({
        lat:         center.lat,
        lng:         center.lng,
        address:     address || null,
        elapsedSecs: Math.round(elapsedSecs),
        knockedAt:   new Date().toISOString(),
        autoPrompt,
      })
    } catch (e) {
      console.warn('[DoorKnock] Detection error:', e.message)
      // Still fire the knock so the user can enter the address manually
      this.onKnock?.({
        lat:         center.lat,
        lng:         center.lng,
        address:     null,
        elapsedSecs: Math.round(elapsedSecs),
        knockedAt:   new Date().toISOString(),
        autoPrompt,
      })
    }
  }

  reset() {
    this.stopOrigin    = null
    this.stopPoints    = []
    this.lastPoint     = null
    this.knockFired    = false
    this.longStopFired = false
  }
}
