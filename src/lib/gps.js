/**
 * GPS Tracking Service
 * Manages continuous location tracking during a canvassing session.
 * Batches GPS points and flushes to Supabase every 30 seconds.
 *
 * v3 — native + background tracking
 * ──────────────────────────────────
 * On iOS/Android (Capacitor) we drive the watcher through
 * @capacitor-community/background-geolocation, which uses native
 * CoreLocation (iOS) and FusedLocationProvider (Android) so the rep's
 * route keeps recording when the screen locks or they switch apps —
 * the entire reason we left the browser.
 *
 * On the web (manager desktop), we fall back to `navigator.geolocation`
 * exactly as before. The platform check is the *only* runtime branch;
 * everything downstream (buffer, flush, mode trade-offs, accuracy
 * filtering) stays unchanged so callers don't need to know which
 * platform they're on.
 *
 * The community plugin is dynamically imported so the web bundle
 * doesn't try to resolve a native-only module at build time.
 *
 * v2 — adaptive polling (still applies)
 * ─────────────────────────────────────
 * The watchPosition options used to be a single preset. In practice a
 * rep walking between houses doesn't need 5 s updates, and a rep
 * standing at a door needs higher accuracy for reverse-geocoding. We
 * expose `setMode(mode)` which re-watches with mode-specific options.
 * The DoorKnockDetector calls this via its `onModeChange` callback so
 * the two systems stay in sync automatically.
 */

import { insertGpsPoints } from './supabase.js'
import { Capacitor, registerPlugin } from '@capacitor/core'

// Register the BackgroundGeolocation native plugin by name. This is the
// official Capacitor pattern for accessing native plugins — at runtime,
// the Capacitor bridge looks up "BackgroundGeolocation" in the plugin
// registry and routes calls to the Swift (iOS) / Kotlin (Android)
// implementation that was wired in during `npx cap sync`. On web,
// method calls reject with "not implemented", which is fine because
// our `Capacitor.isNativePlatform()` checks below ensure we only ever
// call into this on native.
//
// Why this instead of `import { BackgroundGeolocation } from
// '@capacitor-community/background-geolocation'`:
//   - The package's index file imports native-only Swift bridge code
//     that breaks Vite's web build (the original "Failed to resolve
//     entry for package" error). The dynamic-import workaround we tried
//     before was too clever — Capacitor's plugin registration didn't
//     see it, so `addWatcher` never reached CoreLocation and iOS never
//     even added the Location row to the app's Settings panel.
//   - `registerPlugin` lives in `@capacitor/core` (which builds fine on
//     both web and native), takes only a string name, and produces the
//     same proxy object the package's own index file would have given
//     us. Clean separation with no build-time gymnastics.
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

// Discard any reading with accuracy worse than this (meters).
// 50 m is intentionally generous — it filters GPS "jumps" (e.g. sudden 200 m
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
    // Web (navigator.geolocation) keys
    enableHighAccuracy: true,
    timeout:            15000,
    maximumAge:         3000,
    // Native (BackgroundGeolocation) — distance filter in meters between
    // emitted points. Lower = more points, more battery, more detail.
    distanceFilter:     10,
  },
  stopped: {
    enableHighAccuracy: true,
    timeout:            10000,
    maximumAge:         1000,   // insist on fresh fixes for address accuracy
    distanceFilter:     5,
  },
  idle: {
    enableHighAccuracy: false,  // coarse location is fine; saves battery
    timeout:            20000,
    maximumAge:         10000,
    distanceFilter:     25,
  },
}

// (loadBgGeo() previously did a dynamic import of the plugin package.
// Replaced by the module-level `registerPlugin('BackgroundGeolocation')`
// above — see comment there for the rationale.)

class GPSTracker {
  constructor() {
    this.watchId       = null  // browser: number; native: string
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

    // On native we don't gate on `'geolocation' in navigator` — that
    // check is only meaningful for the browser path. Native devices
    // always have GPS; the plugin surfaces a permission error if the
    // rep declined access.
    if (!Capacitor.isNativePlatform() && !('geolocation' in navigator)) {
      onError?.(new Error('Geolocation is not supported on this device.'))
      return false
    }

    this._installWatch()
    this.flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS)
    return true
  }

  stop() {
    this._clearWatch()
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this._flush()   // final flush
    this.isTracking = false
  }

  /**
   * Switch GPS polling mode. No-op if the mode hasn't changed; otherwise
   * clears and re-installs the watch handler with the new options.
   * We tolerate a brief gap (one-frame) between clearing and re-installing;
   * typical devices immediately deliver a cached fix.
   */
  setMode(mode) {
    if (!GPS_MODES[mode]) return
    if (!this.isTracking) { this.mode = mode; return }
    if (this.mode === mode) return
    this.mode = mode
    this._clearWatch()
    this._installWatch()
  }

  getLastPosition() {
    return this.lastPosition
  }

  // ── Watcher install / clear (platform-aware) ──────────────────────────
  _installWatch() {
    if (Capacitor.isNativePlatform()) {
      this._installNativeWatch()
    } else {
      this._installBrowserWatch()
    }
  }

  _installBrowserWatch() {
    const opts = GPS_MODES[this.mode] || GPS_MODES.moving
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handleBrowserPosition(pos),
      (err) => this._handleError(err),
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout:            opts.timeout,
        maximumAge:         opts.maximumAge,
      }
    )
  }

  async _installNativeWatch() {
    // If a mode change raced and another watcher was installed in the
    // meantime, drop this one so we don't end up with two watchers.
    if (this.watchId && typeof this.watchId === 'string') return

    const opts = GPS_MODES[this.mode] || GPS_MODES.moving
    try {
      this.watchId = await BackgroundGeolocation.addWatcher(
        {
          // The text iOS/Android display in the rep's status bar / lock-
          // screen notification when the app is tracking in the
          // background. Apple specifically wants this to be clear and
          // user-facing — vague messages get app submissions rejected.
          backgroundMessage: 'Recording your canvassing route. Tap to return to KnockIQ.',
          backgroundTitle:   'KnockIQ — Session active',
          // The plugin handles the "Always" permission prompt the first
          // time tracking starts. After grant, subsequent sessions
          // resume silently.
          requestPermissions: true,
          // Don't replay the last cached fix — we want fresh data only.
          stale:              false,
          // Mode-driven: tighter filter when the rep is parked at a
          // door, looser when they're walking between houses.
          distanceFilter:     opts.distanceFilter,
        },
        (location, error) => {
          if (error) {
            // 'NOT_AUTHORIZED' is the rep declined permission. Surface
            // it so the UI can show a clear "enable location" CTA.
            this._handleError(new Error(error.message || error.code || String(error)))
            return
          }
          if (!location) return
          this._handleNativePosition(location)
        }
      )
    } catch (err) {
      this._handleError(err)
    }
  }

  async _clearWatch() {
    if (this.watchId === null || this.watchId === undefined) return
    if (Capacitor.isNativePlatform()) {
      try {
        await BackgroundGeolocation.removeWatcher({ id: this.watchId })
      } catch (err) {
        console.warn('[GPS] removeWatcher failed:', err)
      }
    } else if (typeof this.watchId === 'number') {
      navigator.geolocation.clearWatch(this.watchId)
    }
    this.watchId = null
  }

  // ── Position handlers — normalize to one shape ────────────────────────
  _handleBrowserPosition(pos) {
    if (pos.coords.accuracy > MAX_ACCURACY_M) {
      console.debug(`[GPS] Discarding low-accuracy reading: ${pos.coords.accuracy.toFixed(0)}m`)
      return
    }
    this._record({
      lat:       pos.coords.latitude,
      lng:       pos.coords.longitude,
      accuracy:  pos.coords.accuracy,
      speed:     pos.coords.speed,
      // Browser reports `heading` in degrees (0–359, 0 = North). May be
      // null when the device is stationary. The door-knock detector uses
      // it to confirm "turn toward a door" before firing a knock.
      heading:   pos.coords.heading,
      timestamp: pos.timestamp,
    })
  }

  _handleNativePosition(loc) {
    if (loc.accuracy != null && loc.accuracy > MAX_ACCURACY_M) {
      console.debug(`[GPS] Discarding low-accuracy reading: ${loc.accuracy.toFixed(0)}m`)
      return
    }
    this._record({
      lat:       loc.latitude,
      lng:       loc.longitude,
      accuracy:  loc.accuracy != null ? loc.accuracy : null,
      speed:     loc.speed    != null ? loc.speed    : null,
      // Native plugins call it `bearing`; we normalize to `heading` so
      // the door-knock detector and rest of the app keep using one name.
      heading:   loc.bearing  != null ? loc.bearing  : null,
      // Native time field is `time` (ms epoch). Browser uses `timestamp`.
      timestamp: loc.time     != null ? loc.time     : Date.now(),
    })
  }

  _record({ lat, lng, accuracy, speed, heading, timestamp }) {
    const point = {
      session_id:  this.sessionId,
      rep_id:      this.repId,
      lat, lng, accuracy, speed, heading,
      recorded_at: new Date(timestamp).toISOString(),
    }
    this.lastPosition = point
    this.pointBuffer.push(point)
    this.onPosition?.(point)
    if (this.pointBuffer.length >= 20) this._flush()
  }

  _handleError(err) {
    console.warn('[GPS] Error:', err?.message || err)
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

// One-shot permission check. On native this routes through the plugin
// so the rep sees the proper iOS/Android "Always Allow" dialog; on web
// we keep the existing one-shot getCurrentPosition.
export async function requestGPSPermission() {
  if (Capacitor.isNativePlatform()) {
    return new Promise((resolve, reject) => {
      // Install a one-shot watcher just long enough to trigger the
      // permission prompt and receive the first fix, then remove it.
      let resolved = false
      let oneShotId = null
      const startPromise = BackgroundGeolocation.addWatcher(
        { requestPermissions: true, stale: false, distanceFilter: 0 },
        (location, error) => {
          if (resolved) return
          if (error) {
            resolved = true
            if (oneShotId) BackgroundGeolocation.removeWatcher({ id: oneShotId }).catch(() => {})
            reject(new Error(error.message || error.code || String(error)))
            return
          }
          if (!location) return
          resolved = true
          if (oneShotId) BackgroundGeolocation.removeWatcher({ id: oneShotId }).catch(() => {})
          resolve({ lat: location.latitude, lng: location.longitude })
        }
      )
      startPromise.then((id) => { oneShotId = id }).catch(reject)
    })
  }
  // ── Web (manager desktop / mobile browser) ──────────────────────────
  // Browser geolocation only exists in a *secure context* (https: or
  // localhost). If the app is opened over plain http — e.g. a LAN IP from
  // a Capacitor/Vite dev server (http://192.168.x.x:5173) — then
  // navigator.geolocation is unavailable. Surface that precisely instead
  // of blaming the user's permissions. We tag every rejection with a
  // `reason` so the UI can give accurate, actionable guidance.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    const e = new Error('Geolocation requires a secure (https) connection.')
    e.reason = 'insecure'
    return Promise.reject(e)
  }
  if (!('geolocation' in navigator) || !navigator.geolocation) {
    const e = new Error('This browser does not support geolocation.')
    e.reason = 'unsupported'
    return Promise.reject(e)
  }

  const getPos = (opts) =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(err),
        opts,
      )
    })

  try {
    // Fast, high-accuracy fix first — ideal on phones with real GPS.
    return await getPos({ timeout: 10000, enableHighAccuracy: true, maximumAge: 0 })
  } catch (err1) {
    // PERMISSION_DENIED (code 1) is terminal — re-asking won't help.
    if (err1 && err1.code === 1) {
      const e = new Error('Location permission denied.')
      e.reason = 'denied'
      throw e
    }
    // POSITION_UNAVAILABLE (2) / TIMEOUT (3): desktops usually have no GPS
    // and need the slower network (WiFi/IP) lookup. Retry once with low
    // accuracy + a longer timeout before giving up, so web actually works.
    try {
      return await getPos({ timeout: 20000, enableHighAccuracy: false, maximumAge: 60000 })
    } catch (err2) {
      const e = new Error('Could not obtain a location fix.')
      e.reason =
        err2 && err2.code === 1 ? 'denied'
        : err2 && err2.code === 3 ? 'timeout'
        : 'unavailable'
      throw e
    }
  }
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
