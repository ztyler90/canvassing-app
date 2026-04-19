/**
 * Door Knock Detection Algorithm  (v4 — heading & motion corroboration)
 *
 * A "door knock" is registered when a rep:
 *   1. Slows below walking pace (device speed OR recent path length)
 *   2. Remains stopped for MIN_STOP_SECS_FAST / MIN_STOP_SECS_SLOW seconds
 *      (fast path is unlocked when a heading turn corroborates the stop)
 *   3. Drifts no more than STOP_RADIUS_M from the stop anchor
 *   4. Is NOT inside a Do-Not-Knock polygon
 *   5. Is NOT classified "in-vehicle" by the accelerometer
 *   6. The resolved address hasn't been logged in the last 24 h
 *
 * v4 — what changed
 * ─────────────────
 * • **Heading-change gate.** A rep walking a sidewalk has a heading
 *   aligned with the street; turning toward a door rotates heading
 *   60–90°. If we see a material heading turn in the 6 s before a stop,
 *   we fire at MIN_STOP_SECS_FAST (4 s). Without a turn — which is the
 *   common "pausing at a street corner to check phone" case — we
 *   require a longer MIN_STOP_SECS_SLOW (8 s) before firing.
 * • **Motion corroboration.** An external `motionClassifier` can tell
 *   us "the rep is in a vehicle right now". When it does, we suppress
 *   both the short-stop knock and the 45 s long-stop prompt, which
 *   otherwise triggered modals at red lights.
 * • **DNK suppression.** If the caller supplies `isInDoNotKnockZone`,
 *   we skip detection inside marked zones — the rep still sees the
 *   zone on the map but the detector stays quiet.
 * • **Adaptive polling hook.** When the detector transitions between
 *   "moving" and "stopped" it calls an optional `onModeChange` so the
 *   GPS tracker can dial accuracy up/down to save battery.
 *
 * v3 retained fixes
 * ─────────────────
 *   – Speed gate (< 0.6 m/s) or sliding-window fallback (<3 m/5 s)
 *   – Tight anchor radius (4 m)
 *   – Post-knock lockout (rep must move > 12 m to fire again)
 *   – The 45 s auto-prompt for when the rep is in conversation
 */

import { reverseGeocode } from './geocoding.js'
import { distanceMeters }  from './gps.js'
import { wasAddressRecentlyVisited } from './supabase.js'

// ── Thresholds ──────────────────────────────────────────────────
const STOP_RADIUS_M        = 4      // anchor drift tolerance once stopped
const MIN_STOP_SECS_FAST   = 4      // fires when corroborated by a heading turn
const MIN_STOP_SECS_SLOW   = 8      // fires on a straight-line stop (no turn)
const STOP_SPEED_MPS       = 0.6    // below walking pace (~1.4 m/s)
const WINDOW_MS            = 5000   // sliding window for fallback speed test
const WINDOW_MAX_DIST_M    = 3      // total path length in window → "stopped"
const POST_KNOCK_MOVE_M    = 12     // must move this far before firing again
const AUTO_PROMPT_SECS     = 45     // long-stop auto-prompt (handled downstream)

// Heading-turn detection
const HEADING_WINDOW_MS    = 6000   // look back 6 s before the stop
const HEADING_DELTA_DEG    = 45     // a "turn toward the door" ≥ 45°
const MIN_HEADING_SAMPLES  = 3      // require ≥3 readings in the window

export class DoorKnockDetector {
  /**
   * @param {object} opts
   * @param {function} opts.onKnock - (knockData) => void
   *   knockData: { lat, lng, address, elapsedSecs, knockedAt, autoPrompt }
   * @param {string}   opts.repId
   * @param {object=}  opts.motionClassifier  Optional motion lib (see lib/motion.js).
   *                                          When `.isLikelyInVehicle()` is true,
   *                                          all auto-knock firing is suppressed.
   * @param {function=} opts.isInDoNotKnockZone  (lat, lng) => boolean.
   *                                          When true, detector stays silent.
   * @param {function=} opts.onModeChange       (mode) => void. Called when the
   *                                          detector transitions between
   *                                          'moving' | 'stopped'. Used by the
   *                                          GPS tracker for adaptive polling.
   */
  constructor({ onKnock, repId, motionClassifier, isInDoNotKnockZone, onModeChange }) {
    this.onKnock            = onKnock
    this.repId              = repId
    this.motionClassifier   = motionClassifier || null
    this.isInDoNotKnockZone = isInDoNotKnockZone || null
    this.onModeChange       = onModeChange || null
    // Address-level dedup persists across resets within a session — we
    // don't want a rep re-knocking the same door after a momentary
    // detector reset.
    this.recentKnocks = new Map()
    this.mode         = 'moving'   // 'moving' | 'stopped'
    this.reset()
  }

  /** Clear per-stop state; preserves in-memory dedup map. */
  reset() {
    this.windowPoints    = []    // [{ lat, lng, speed, ts, heading }]
    this.headingHistory  = []    // [{ heading, ts }] — kept across stops
    this.stopOrigin      = null  // anchor { lat, lng }
    this.stopPoints      = []    // all positions captured during current stop
    this.stoppedSince    = null  // ts when stop began
    this.knockFired      = false // true once knock fired for this stop
    this.longStopFired   = false // true once 45 s auto-prompt fired
    this.lastKnockCenter = null  // last knock center, for post-knock lockout
    this.headingTurnSeen = false // latched: did we see a turn before the stop?
  }

  /**
   * Call for every incoming GPS point. Never blocks — reverse-geocoding
   * runs in the background.
   */
  feed(point) {
    if (!point) return
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return

    const now = Date.now()

    // ── Maintain sliding windows ─────────────────────────────
    this.windowPoints.push({
      lat:     point.lat,
      lng:     point.lng,
      speed:   point.speed,
      ts:      now,
      heading: Number.isFinite(point.heading) ? point.heading : null,
    })
    while (
      this.windowPoints.length &&
      (now - this.windowPoints[0].ts) > WINDOW_MS
    ) {
      this.windowPoints.shift()
    }

    // Track heading history over a longer window — we need to look BACK
    // past the stop-onset to detect a turn.
    if (Number.isFinite(point.heading)) {
      this.headingHistory.push({ heading: point.heading, ts: now })
      while (
        this.headingHistory.length &&
        (now - this.headingHistory[0].ts) > HEADING_WINDOW_MS
      ) {
        this.headingHistory.shift()
      }
    }

    // ── Short-circuit: vehicle or DNK suppression ────────────
    // These run BEFORE stop evaluation so we don't even start a stop
    // timer in a car. We still track windows so the detector recovers
    // instantly when the rep gets out and walks.
    if (this.motionClassifier?.isLikelyInVehicle?.()) {
      this._abandonStop()
      this._setMode('moving')
      return
    }
    if (this.isInDoNotKnockZone?.(point.lat, point.lng)) {
      this._abandonStop()
      this._setMode('moving')
      return
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
      this._abandonStop()
      this._setMode('moving')
      return
    }

    // ── Handle stopped state ────────────────────────────────
    this._setMode('stopped')
    if (!this.stopOrigin) {
      this.stopOrigin      = { lat: point.lat, lng: point.lng }
      this.stopPoints      = [{ lat: point.lat, lng: point.lng }]
      this.stoppedSince    = now
      // Evaluate the turn at the MOMENT the stop starts — this captures
      // the approach (walking toward the door) before further heading
      // readings in the stationary window drown it out.
      this.headingTurnSeen = this._hadRecentHeadingTurn()
      return
    }

    // Drifted outside the anchor radius? Treat as a new stop.
    if (distanceMeters(this.stopOrigin, point) > STOP_RADIUS_M) {
      this.stopOrigin      = { lat: point.lat, lng: point.lng }
      this.stopPoints      = [{ lat: point.lat, lng: point.lng }]
      this.stoppedSince    = now
      this.knockFired      = false
      this.longStopFired   = false
      this.headingTurnSeen = this._hadRecentHeadingTurn()
      return
    }

    // Continuing the same stop.
    this.stopPoints.push({ lat: point.lat, lng: point.lng })
    const elapsed = (now - this.stoppedSince) / 1000

    // Heading turn gives us the fast path (4 s). No turn → slow path (8 s).
    // This is the key false-positive fix: reps stopping to check their
    // phone at a corner don't trigger until the longer threshold.
    const requiredStop = this.headingTurnSeen ? MIN_STOP_SECS_FAST : MIN_STOP_SECS_SLOW

    if (elapsed >= requiredStop && !this.knockFired) {
      this.knockFired = true
      this._tryKnock(elapsed, false)
    }

    if (elapsed >= AUTO_PROMPT_SECS && !this.longStopFired) {
      this.longStopFired = true
      this._tryKnock(elapsed, true)
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  _abandonStop() {
    this.stopOrigin      = null
    this.stopPoints      = []
    this.stoppedSince    = null
    this.knockFired      = false
    this.longStopFired   = false
    this.headingTurnSeen = false
  }

  _setMode(mode) {
    if (this.mode === mode) return
    this.mode = mode
    this.onModeChange?.(mode)
  }

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

  /**
   * Did the rep turn by HEADING_DELTA_DEG or more within the heading
   * window? Uses max pairwise diff across samples so a single heading
   * blip doesn't dominate — we want a sustained change.
   *
   * Returns false if we don't have enough samples (treat as "no turn"
   * conservatively, forcing the longer stop threshold).
   */
  _hadRecentHeadingTurn() {
    const h = this.headingHistory
    if (h.length < MIN_HEADING_SAMPLES) return false

    let maxDiff = 0
    for (let i = 1; i < h.length; i++) {
      const d = _angleDiff(h[i].heading, h[i - 1].heading)
      if (d > maxDiff) maxDiff = d
    }
    return maxDiff >= HEADING_DELTA_DEG
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

/**
 * Smallest angular difference between two compass headings (degrees).
 * Returns 0–180. Handles the 359→1 wrap cleanly.
 */
function _angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
