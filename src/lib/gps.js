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
import { Capacitor } from '@capacitor/core'

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

// Lazy native-plugin loader. Web builds never hit this path so the
// import never resolves, which keeps the manager desktop bundle from
// trying to pull in a native-only module.
let _bgGeoPromise = null
function loadBgGeo() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null)
  if (!_bgGeoPromise) {
    // We hide the module path behind a variable so neither Vite's nor
    // vite-plugin-pwa's Rollup pass can statically analyze it at build time.
    // The web bundle can't resolve the native-only Capacitor plugin —
    // without this indirection, vite-plugin-pwa's worker-build pass fails
    // with "Failed to resolve entry for package". The runtime check above
    // ensures this code path only executes on iOS/Android.
    const bgGeoModule = ['@capacitor-community', 'background-geolocation'].join('/')
    _bgGeoPromise = import(/* @vite-ignore */ bgGeoModule)
      .then((mod) => mod.BackgroundGeolocation || mod.default || mod)
      .catch((err) => {
        console.warn('[GPS] background-geolocation plugin failed to load:', err)
        _bgGeoPromise = null
        return null
      })
  }
  return _bgGeoPromise
}

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
    const BgGeo = await loadBgGeo()
    if (!BgGeo) {
      this._handleError(new Error('Background geolocation plugin unavailable'))
      return
    }
    // If a mode change raced and another watcher was installed in the
    // meantime, drop this one so we don't end up with two watchers.
    if (this.watchId && typeof this.watchId === 'string') return

    const opts = GPS_MODES[this.mode] || GPS_MODES.moving
    try {
      this.watchId = await BgGeo.addWatcher(
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
      const BgGeo = await loadBgGeo()
      if (BgGeo) {
        try {
          await BgGeo.removeWatcher({ id: this.watchId })
        } catch (err) {
          console.warn('[GPS] removeWatcher failed:', err)
        }
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
    const BgGeo = await loadBgGeo()
    if (!BgGeo) throw new Error('Background geolocation plugin unavailable')
    return new Promise((resolve, reject) => {
      // Install a one-shot watcher just long enough to trigger the
      // permission prompt and receive the first fix, then remove it.
      let resolved = false
      let oneShotId = null
      const startPromise = BgGeo.addWatcher(
        { requestPermissions: true, stale: false, distanceFilter: 0 },
        (location, error) => {
          if (resolved) return
          if (error) {
            resolved = true
            if (oneShotId) BgGeo.removeWatcher({ id: oneShotId }).catch(() => {})
            reject(new Error(error.message || error.code || String(error)))
            return
          }
          if (!location) return
          resolved = true
          if (oneShotId) BgGeo.removeWatcher({ id: oneShotId }).catch(() => {})
          resolve({ lat: location.latitude, lng: location.longitude })
        }
      )
      startPromise.then((id) => { oneShotId = id }).catch(reject)
    })
  }
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
