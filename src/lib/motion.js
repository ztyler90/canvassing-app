/**
 * Motion Classifier
 * ─────────────────
 * Uses `DeviceMotionEvent` (accelerometer) to decide, at any moment,
 * whether the rep is most likely:
 *   • stationary (phone held still)
 *   • walking    (rhythmic 1–2 Hz accel bursts)
 *   • in-vehicle (mostly still with occasional road-noise spikes)
 *
 * Why this exists
 * ───────────────
 * The door-knock detector already gates on GPS speed, but GPS speed is
 * noisy at low values and occasionally reports < 0.6 m/s while a rep is
 * actually cruising in traffic at a red light. The accelerometer gives
 * us a second signal that's independent of GPS: a rep who's "in a car"
 * has a very different accel signature from a rep approaching a door.
 *
 * The public API returns a classification the detector can *corroborate*
 * with — it never overrides GPS on its own. If motion says "vehicle"
 * we suppress auto-knocks entirely; if motion is unavailable we fall
 * back to the old GPS-only behavior.
 *
 * Permissions
 * ───────────
 * iOS 13+ Safari requires `DeviceMotionEvent.requestPermission()` to be
 * called from a user gesture. We expose `startMotion()` so callers can
 * hook it to a tap (e.g. the Start Canvassing button). On Android and
 * desktop Chrome this is a no-op and motion events start immediately.
 */

const WINDOW_MS        = 4000   // analyze motion over a 4-second sliding window
const MAX_SAMPLES      = 200    // cap window size to bound memory

// Magnitude (m/s²) thresholds after subtracting 9.8 g.
// Walking creates 1.5–4 m/s² bursts at step frequency; a phone riding
// in a car cupholder sees <0.5 m/s² most of the time with rare spikes.
const WALK_STD_MIN     = 0.9    // stddev of accel magnitude → walking
const VEHICLE_STD_MAX  = 0.3    // below this + low freq = vehicle

// How often a step-rhythm peak must occur for us to call it walking.
// 1.5–2.5 Hz covers most human gaits; below that it's probably idling.
const MIN_STEP_HZ      = 1.2

class MotionClassifier {
  constructor() {
    this._samples       = []     // [{ ts, mag }]
    this._listening     = false
    this._permission    = 'unknown'  // 'unknown' | 'granted' | 'denied' | 'unavailable'
    this._handler       = null
  }

  /** True if the platform exposes DeviceMotionEvent at all. */
  isSupported() {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window
  }

  /**
   * Attempt to start listening. On iOS this MUST be invoked from a user
   * gesture (button tap) or the permission prompt will silently reject.
   * Safe to call repeatedly — subsequent calls are no-ops.
   */
  async start() {
    if (this._listening) return this._permission
    if (!this.isSupported()) {
      this._permission = 'unavailable'
      return this._permission
    }

    // iOS Safari: explicit permission. Other browsers: no-op.
    const reqFn = window.DeviceMotionEvent?.requestPermission
    if (typeof reqFn === 'function') {
      try {
        const res = await reqFn.call(window.DeviceMotionEvent)
        this._permission = res === 'granted' ? 'granted' : 'denied'
        if (this._permission !== 'granted') return this._permission
      } catch {
        this._permission = 'denied'
        return this._permission
      }
    } else {
      this._permission = 'granted'
    }

    this._handler = (e) => this._onMotion(e)
    window.addEventListener('devicemotion', this._handler, { passive: true })
    this._listening = true
    return this._permission
  }

  stop() {
    if (!this._listening) return
    window.removeEventListener('devicemotion', this._handler)
    this._handler   = null
    this._listening = false
  }

  _onMotion(e) {
    // accelerationIncludingGravity is available in all browsers; plain
    // `acceleration` is not. We subtract 9.8 to approximate linear accel.
    const a = e.accelerationIncludingGravity
    if (!a || a.x == null) return
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) - 9.8
    const ts  = Date.now()
    this._samples.push({ ts, mag })
    // Trim out of window + cap length
    while (this._samples.length && ts - this._samples[0].ts > WINDOW_MS) {
      this._samples.shift()
    }
    if (this._samples.length > MAX_SAMPLES) {
      this._samples.splice(0, this._samples.length - MAX_SAMPLES)
    }
  }

  /**
   * Classify the current motion state based on the sliding window.
   * Returns one of: 'stationary' | 'walking' | 'vehicle' | 'unknown'
   *
   * 'unknown' means we don't have enough data (or the sensor isn't
   * available) — the detector should then fall back to GPS-only logic.
   */
  classify() {
    if (!this._listening || this._permission !== 'granted') return 'unknown'
    const s = this._samples
    if (s.length < 12) return 'unknown' // need ~1.2 s of data at 10 Hz

    // Mean + stddev of magnitude
    let sum = 0
    for (const x of s) sum += x.mag
    const mean = sum / s.length
    let sq = 0
    for (const x of s) sq += (x.mag - mean) * (x.mag - mean)
    const std = Math.sqrt(sq / s.length)

    // Count zero-crossings to estimate step frequency. Walking produces
    // periodic crossings of the zero-centered accel magnitude; sitting
    // still or riding produces very few.
    let crossings = 0
    for (let i = 1; i < s.length; i++) {
      if ((s[i - 1].mag >= 0) !== (s[i].mag >= 0)) crossings++
    }
    const spanS = (s[s.length - 1].ts - s[0].ts) / 1000 || 1
    const stepHz = crossings / (2 * spanS)   // two crossings per cycle

    if (std >= WALK_STD_MIN && stepHz >= MIN_STEP_HZ) return 'walking'
    if (std <= VEHICLE_STD_MAX && stepHz < MIN_STEP_HZ) return 'vehicle'
    return 'stationary'
  }

  /**
   * Convenience: would auto-knock detection lead to a false positive
   * right now? True when we're confident the rep is in a vehicle and
   * not actually approaching a door on foot.
   */
  isLikelyInVehicle() {
    return this.classify() === 'vehicle'
  }

  permissionState() {
    return this._permission
  }
}

export const motionClassifier = new MotionClassifier()
