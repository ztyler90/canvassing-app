/**
 * Door Knock Detection Algorithm  (v3 — speed-gated stop detection)
 *
 * A "door knock" is registered when a rep:
 *   1. Slows below walking pace (device speed OR recent path length)
 *   2. Remains stopped for MIN_STOP_SECS seconds
 *   3. Drifts no more than STOP_RADIUS_M from the stop anchor
 *   4. And the resolved address hasn't been logged in the last 24 h
 *
 * v3 — why it changed
 * ───────────────────
 * v2 fired a knock whenever the rep stayed within 15 m of an anchor
 * for 5 seconds. A brisk walk (~1.4 m/s) only covers 7 m in 5 s — which
 * is INSIDE the old 15 m radius — so reps were getting false-triggered
 * modals while walking between houses. v3 fixes this by:
 *
 * • **Gating on actual speed.** Every modern phone reports
 *   `pos.coords.speed` in m/s. If it's below 0.6 m/s we consider the
 *   rep "stopped" (walking is 1.2–1.8 m/s).
 * • **Sliding-window fallback.** On devices that report speed as null,
 *   we compute total path length over the last 5 seconds and require
 *   < 3 m of travel to call the rep stopped.
 * • **Tighter anchor radius** (15 m → 4 m). Once stopped, drift beyond
 *   4 m re-anchors the stop rather than continuing it.
 * • **Post-knock lockout.** After firing a knock, the rep must move
 *   > 12 m from the knock center before another can fire. Prevents
 *   a second phantom knock from being triggered while still at the door.
 * • The 45 s auto-prompt (for when the rep is in conversation) is
 *   preserved — it still fires through the same onKnock callback so
 *   ActiveCanvassing can choose whether to auto-open the modal.
 */

import { reverseGeocode } from './geocoding.js'
import { distanceMeters }  from './gps.js'
import { wasAddressRecentlyVisited } from './supabase.js'

// ── Thresholds ──────────────────────────────────────────────────
const STOP_RADIUS_M      = 4      // anchor drift tolerance once stopped
const MIN_STOP_SECS      = 4      // seconds stopped to qualify as a knock
const STOP_SPEED_MPS     = 0.6    // below walking pace (~1.4 m/s)
const WINDOW_MS          = 5000   // sliding window for fallback speed test
const WINDOW_MAX_DIST_M  = 3      // total path length in window → "stopped"
const POST_KNOCK_MOVE_M  = 12     // must move this far before firing again
const AUTO_PROMPT_SECS   = 45     // long-stop auto-prompt (handled downstream)

export class DoorKnockDetector {
  /**
   * @param {object} opts
   * @param {function} opts.onKnock - (knockData) => void
   *   knockData: { lat, lng, address, elapsedSecs, knockedAt, autoPrompt }
   * @param {string}   opts.repId
   */
  constructor({ onKnock, repId }) {
    this.onKnock      = onKnock
    this.repId        = repId
    // Address-level dedup persists across resets within a session — we
    // don't want a rep re-knocking the same door after a momentary
    // detector reset.
    this.recentKnocks = new Map()
    this.reset()
  }

  /** Clear per-stop state; preserves in-memory dedup map. */
  reset() {
    this.windowPoints    = []    // [{ lat, lng, speed, ts }] in last WINDOW_MS
    this.stopOrigin      = null  // anchor { lat, lng }
    this.stopPoints      = []    // all positions captured during current stop
    this.stoppedSince    = null  // ts when stop began
    this.knockFired      = false // true once knock fired for this stop
    this.longStopFired   = false // true once 45 s auto-prompt fired
    this.lastKnockCenter = null  // last knock center, for post-knock lockout
  }

  /**
   * Call for every incoming GPS point. Never blocks — reverse-geocoding
   * runs in the background.
   */
  feed(point) {
    if (!point) return
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return

    const now = Date.now()

    // ── Maintain sliding window ─────────────────────────────
    this.windowPoints.push({
      lat:   point.lat,
      lng:   point.lng,
      speed: point.speed,
      ts:    now,
    })
    while (
      this.windowPoints.length &&
      (now - this.windowPoints[0].ts) > WINDOW_MS
    ) {
      this.windowPoints.shift()
    }

    // ── Post-knock lockout ──────────────────────────────────
    // After a knock fires, ignore stop detection until the rep has
    // clearly left the door. Prevents a second phantom knock on the
    // same porch.
    if (this.lastKnockCenter) {
      const dFromLast = distanceMeters(this.lastKnockCenter, point)
      if (dFromLast < POST_KNOCK_MOVE_M) return
      this.lastKnockCenter = null
    }

    const stopped = this._isStopped(point)

    if (!stopped) {
      // Moving — abandon any in-progress stop.
      this.stopOrigin    = null
      this.stopPoints    = []
      this.stoppedSince  = null
      this.knockFired    = false
      this.longStopFired = false
      return
    }

    // ── Handle stopped state ────────────────────────────────
    if (!this.stopOrigin) {
      this.stopOrigin   = { lat: point.lat, lng: point.lng }
      this.stopPoints   = [{ lat: point.lat, lng: point.lng }]
      this.stoppedSince = now
      return
    }

    // Drifted outside the anchor radius? Treat as a new stop.
    if (distanceMeters(this.stopOrigin, point) > STOP_RADIUS_M) {
      this.stopOrigin    = { lat: point.lat, lng: point.lng }
      this.stopPoints    = [{ lat: point.lat, lng: point.lng }]
      this.stoppedSince  = now
      this.knockFired    = false
      this.longStopFired = false
      return
    }

    // Continuing the same stop.
    this.stopPoints.push({ lat: point.lat, lng: point.lng })
    const elapsed = (now - this.stoppedSince) / 1000

    if (elapsed >= MIN_STOP_SECS && !this.knockFired) {
      this.knockFired = true
      this._tryKnock(elapsed, false)
    }

    if (elapsed >= AUTO_PROMPT_SECS && !this.longStopFired) {
      this.longStopFired = true
      this._tryKnock(elapsed, true)
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  /**
   * Decide whether the rep is stopped right now.
   * Prefers device-reported speed; falls back to sliding-window path length.
   */
  _isStopped(point) {
    // Preferred: device speed (reliable on iOS, most modern Androids).
    if (point.speed != null && Number.isFinite(point.speed)) {
      return point.speed < STOP_SPEED_MPS
    }

    // Fallback: compute total path length across the sliding window.
    // Need at least 3 points spanning ≥3 s so a single cached reading
    // doesn't prematurely call the rep stopped.
    const pts = this.windowPoints
    if (pts.length < 3) return false

    const span = (pts[pts.length - 1].ts - pts[0].ts) / 1000
    if (span < 3) return false

    // Path length (not endpoint distance) — catches jittery motion that
    // would look stopped if we only measured start-to-end.
    let totalDist = 0
    for (let i = 1; i < pts.length; i++) {
      totalDist += distanceMeters(pts[i - 1], pts[i])
    }
    return totalDist < WINDOW_MAX_DIST_M
  }

  /** Centroid of all GPS readings captured during the current stop. */
  _centroid() {
    const n = this.stopPoints.length
    if (n === 0) return this.stopOrigin
    const sum = this.stopPoints.reduce(
      (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
      { lat: 0, lng: 0 }
    )
    return { lat: sum.lat / n, lng: sum.lng / n }
  }

  /**
   * Attempt to register a knock. Runs the reverse-geocode + DB dedup
   * asynchronously so feed() never blocks.
   */
  async _tryKnock(elapsedSecs, autoPrompt = false) {
    const center = this._centroid()
    // Engage the post-knock lockout around the fire location.
    this.lastKnockCenter = { lat: center.lat, lng: center.lng }

    try {
      const address = await reverseGeocode(center.lat, center.lng)

      if (address) {
        // Fast in-memory dedup (session-scoped)
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
      // Fire anyway so the rep can fill in the address manually.
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
}
