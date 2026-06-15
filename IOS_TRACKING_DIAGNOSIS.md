# iOS Active-Canvassing Tracking — Diagnosis & Fixes

_Goal: make native (iOS app) session tracking behave as seamlessly as the web version. This reviews the whole tracking path (GPS watcher → door detection → live map → session persistence) for places where iOS behaves differently from the browser._

## How native and web tracking differ (the root of most issues)

- **Web** (`navigator.geolocation.watchPosition`) streams a position roughly **once per second, continuously**, even when the rep is standing still, and JavaScript keeps running as long as the tab is visible.
- **Native iOS** uses the background-geolocation plugin → CoreLocation. It only emits points based on a **distance filter**, it keeps running **in the background** (screen locked / app switched) — but the **WebView's JavaScript timers are suspended** the moment the app loses the foreground.

Almost every gap below comes from one of those two differences.

## Findings

### 1. Auto door-detection never fired on iOS — FIXED
The native watcher used a distance filter (10 m moving / 5 m stopped). A distance filter tells iOS to emit nothing until the phone physically moves that far, so a rep **standing still at a door produced zero GPS points**, the detector was never fed, and its dwell timer never advanced. Web streams continuously, so it only broke on the app.
**Fix:** `distanceFilter: 0` during active canvassing (`src/lib/gps.js`) → continuous time-based fixes, like the browser. Also stopped the watcher from needlessly restarting on the moving↔stopped transition.

### 2. Map froze after "Re-center" on iOS — FIXED
The map's auto-follow does programmatic `panTo`s to keep you centered. On iOS touch, those programmatic pans emit a phantom "user dragged the map" event, which flipped the map into explore-mode and froze following. Web (mouse) never emits that phantom event.
**Fix:** only treat a drag as exploring when a real finger is pressed on the map (`src/components/MapView.jsx`).

### 3. Buffered route points could be lost when the app backgrounds — FIXED
GPS points batch in memory and flush to the database on a 30-second timer. On iOS that timer is **suspended** when the rep locks the phone or switches apps, and the app can be killed without warning — taking any unflushed points with it.
**Fix:** flush immediately on `visibilitychange→hidden` / `pagehide` (the events WKWebView fires when backgrounding), plus a public `flush()` (`src/lib/gps.js`). The native plugin keeps *collecting* in the background regardless; this guarantees what's already collected reaches the DB before a suspend.

### 4. Live manager-map pin stopped moving in the background on iOS — FIXED
The rep's live location (the "Live" tab pin) was pushed only by a **15-second `setInterval`**, which iOS suspends in the background — so a manager watching live saw the rep freeze whenever the phone was pocketed, even though the route was still recording.
**Fix:** also push the live pin from the GPS position callback (which keeps firing from the native plugin in the background), throttled to ~12 s and sharing one throttle with the timer so there's no double-writing (`src/screens/ActiveCanvassing.jsx`).

## Already correct (verified, no change needed)

- **Background location is properly configured.** `ios/App/App/Info.plist` has `UIBackgroundModes = location`, plus all three location usage strings (`WhenInUse`, `Always`, `AlwaysAndWhenInUse`) with clear, Apple-friendly wording. This is what lets tracking continue when the screen locks.
- **Motion permission** (accelerometer, used to corroborate knocks) is requested from the Start-Canvassing tap, as iOS 13+ requires; if denied, detection falls back to GPS-only.
- **Session resume** is backed by a DB + localStorage cache, so a refresh/relaunch can resume where the rep left off.
- **The app correctly skips the web "keep this screen open" wake-lock banner on native** — background mode makes it unnecessary.

## Optional hardening (needs a native package — your call, not required for correctness)

- **Keep the screen awake during a session.** The current wake-lock uses the Web Wake Lock API, which **iOS WKWebView doesn't support**, so it no-ops on the app. Tracking still continues in the background, so this is a UX nicety (screen stays on while actively canvassing), not a tracking fix. If you want it, add `@capacitor-community/keep-awake` and call it on session start/end. Requires `npm i` + `npx cap sync ios` + a rebuild.
- **More robust foreground/background detection** via `@capacitor/app`'s `appStateChange`. The `visibilitychange`/`pagehide` events we now use are reliable in WKWebView, so this is belt-and-suspenders, not essential.

## A trade-off to keep an eye on

Continuous GPS (`distanceFilter: 0`) is what makes detection and live tracking work, but it uses more battery and writes more location rows than a filtered stream (the web app already behaves this way). If reps report battery drain in the field, the refinement is to drop the filter to 0 only once the rep slows down, rather than for the whole session — an optimization, not needed for correctness.

## What to test on the next iOS build

These fixes reach the iOS app **only in a new build** (Capacitor bundles a snapshot of the web app), so they won't affect the build currently in App Store review.

1. Stand at a door ~6–8 s → a gray "no answer" pin should drop.
2. Walk → pan the map away → tap Re-center → keep walking → the map should keep following you.
3. Start a session, lock the phone, walk a block, unlock → the route trail should be continuous (no gap), and a manager watching "Live" should have seen the pin move while you were locked.
4. End a session right after locking/relaunching → confirm no points are missing from the tail of the route.
