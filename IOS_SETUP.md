# KnockIQ iOS Setup Guide

End-to-end checklist for going from this repo on your Mac to the app
running on your iPhone, then on TestFlight, then on the App Store.

| | |
|---|---|
| Bundle ID | `com.getknockiq.app` |
| App name | `KnockIQ` |
| Background GPS | ✅ enabled — `@capacitor-community/background-geolocation` |
| Apple team | (your KnockIQ LLC team — set in Xcode in step 4) |

**Repo prep is already done.** The web build, the GPS platform branch,
and the Vite externalization of the native plugin are all in place. You
don't need to edit any source files. The only manual work is on your
Mac: installing tools, adding the iOS platform, pasting the Info.plist
strings, and pointing Xcode at your iPhone.

---

## 1. One-time local Mac setup

These steps you do **once** on the Mac you'll use to build the iOS app.

### 1a. Install prerequisites
```bash
# Xcode — install from the App Store (it's a multi-GB download, do this first).
# Then accept the license:
sudo xcodebuild -license accept

# CocoaPods (Capacitor uses it to manage native iOS dependencies)
sudo gem install cocoapods
# If that errors on newer macOS (the system Ruby is locked down on Apple
# Silicon), use Homebrew instead:
#   brew install cocoapods

# Verify
xcodebuild -version
pod --version
```

### 1b. Pull the repo and install dependencies
```bash
cd /path/to/canvassing-app
git pull
npm install
```

`npm install` picks up the Capacitor packages already declared in
`package.json` (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`,
`@capacitor/geolocation`, `@capacitor-community/background-geolocation`,
`@capacitor/status-bar`, `@capacitor/splash-screen`).

> **Why the web build still works after adding a native-only plugin:**
> `vite.config.js` already marks `@capacitor-community/background-geolocation`
> as `external` for the Rollup pass and excludes it from optimizeDeps, and
> `src/lib/gps.js` hides the dynamic import path behind a variable so
> vite-plugin-pwa's worker-build pass can't statically resolve it either.
> Both fixes are in the repo already; you don't need to redo them.

### 1c. Add the iOS platform
This creates the `ios/` directory with a real Xcode project inside.
**Run this once, then commit the entire `ios/App` folder** (the
`.gitignore` already excludes Pods, derived data, and Xcode user
state, so only the project files themselves end up in git).

```bash
npx cap add ios
```

You should see a new `ios/App/App.xcworkspace` file. That's the file
you'll open in Xcode — never the `.xcodeproj`, or CocoaPods
dependencies won't resolve.

### 1d. First sync
```bash
npm run ios:sync     # = vite build && cap sync ios
```

This is wired up as an npm script in `package.json`. Under the hood it
builds the web app into `dist/`, then runs `cap sync ios` which
copies `dist/` into the iOS project and runs `pod install` to download
the native dependencies (CoreLocation wrappers, etc.). First run takes
a minute or two.

---

## 2. Info.plist additions

Apple requires a human-readable explanation for every permission the
app asks for. **Missing or vague strings cause two failure modes:** the
app silently crashes when it touches a protected API, AND your App
Store submission gets rejected.

Open `ios/App/App/Info.plist` in Xcode (or any text editor — it's XML)
and add these keys inside the top-level `<dict>`. The wording below is
calibrated for Apple's reviewers — they want concrete, specific
language tied to the app's actual function.

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>KnockIQ uses your location to map the route you walk while canvassing, so your manager can see coverage and reps can see their own door history.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>KnockIQ tracks your canvassing route in the background so your session keeps recording when your phone locks or you switch apps. Tracking only runs while a canvassing session is active — it stops automatically when you end the session.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>KnockIQ tracks your canvassing route in the background so your session keeps recording when your phone locks or you switch apps. Tracking only runs while a canvassing session is active.</string>

<key>NSCameraUsageDescription</key>
<string>KnockIQ uses the camera to attach photos to booked jobs and estimate-request documentation.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>KnockIQ accesses your photo library so you can attach existing photos to a job booking.</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
</array>
```

**Why these specific keys and no others:** I audited every browser API
used in `src/`. Voice notes were removed (BIPA legal concerns in
`supabase.js`), so `NSMicrophoneUsageDescription` is **not needed**.
Photo uploads use a standard `<input type="file" accept="image/*">`
which iOS shows as a sheet with "Take Photo" and "Photo Library"
options — both `NSCameraUsageDescription` and
`NSPhotoLibraryUsageDescription` are required for that input to work.
No `NSPhotoLibraryAddUsageDescription` because we only read from the
library, never write to it.

The `UIBackgroundModes` → `location` entry is what actually lets iOS
keep delivering GPS updates to the app after the screen locks. Without
it, `@capacitor-community/background-geolocation` can't run.

### Save and re-sync
After editing Info.plist:
```bash
npx cap sync ios
```

This propagates the changes into the Xcode project's build settings.

---

## 3. Enable Background Modes in Xcode

The Info.plist entry above tells iOS what the app *might* do; the
Xcode capability tells iOS to actually grant it.

1. Open the workspace: `npx cap open ios` (or `npm run ios:open`)
2. Click the **App** target in the left sidebar (top item under "App").
3. Go to the **Signing & Capabilities** tab.
4. Click **+ Capability** → choose **Background Modes**.
5. In the Background Modes box that appears, check **Location updates**.
   You can also check "Background fetch" since we added it to
   Info.plist; harmless if you skip it.

This adds an entitlement that tells the OS "yes, this app is allowed
to keep running for location updates."

---

## 4. Signing — connecting the project to your Apple Developer account

Still in **Signing & Capabilities**:

1. **Team**: from the dropdown, select your KnockIQ LLC team (the one
   tied to the Apple Developer account that got approved). If you don't
   see it, sign into Xcode → Settings → Accounts with the Apple ID
   you used for the Developer Program enrollment.
2. **Bundle Identifier**: confirm it reads `com.getknockiq.app`. If
   it shows anything else, change it here — and update
   `capacitor.config.json` to match before the next sync.
3. **Signing Certificate**: leave as "Apple Development" for now (this
   is for installing on your own devices). The "Apple Distribution"
   cert is only needed at App Store submission time and Xcode will
   provision it automatically when you upload your first build.
4. **Provisioning Profile**: leave as "Xcode Managed Profile". Don't
   manually configure profiles unless you have a reason; the automatic
   path handles certificate juggling for you.

When you change the team for the first time, Xcode talks to Apple's
servers to register the bundle ID and create a development provisioning
profile. Takes 10–30 seconds.

---

## 5. Run on your iPhone

1. **Plug your iPhone into the Mac with a Lightning/USB-C cable.** WiFi
   debugging works too but cable is more reliable for first runs.
2. On your iPhone, when prompted, **trust this computer**.
3. Back in Xcode, at the top of the window next to the play button,
   click the device dropdown and select your iPhone. **Not a simulator** —
   simulators can't test GPS or background tracking meaningfully.
4. Click the **▶ Run** button (or `⌘ + R`).
5. First build takes 1–3 minutes (compiling native plugins, etc.).
   Subsequent builds are much faster.
6. The first time the app launches on your phone, iOS will show
   **"Untrusted Developer"** and refuse to open it. To fix:
   - On the iPhone: **Settings → General → VPN & Device Management**
     (older iOS: **Profiles & Device Management**).
   - Tap your developer cert under "Developer App".
   - Tap **Trust "[your team name]"**.
   - Go back and tap the KnockIQ app icon.
7. When you start a canvassing session, the app will ask for location
   permission. Tap **"Allow While Using App"** first, then iOS will
   *separately* prompt to upgrade to **"Always Allow"** when the
   background-geolocation plugin starts. Accept that too — without
   "Always Allow", background tracking won't work.

---

## 6. Iterative dev loop

After the initial setup, the day-to-day loop is:

```bash
# Make web code changes in src/
npm run ios:sync       # rebuild the web bundle + sync into iOS project
# Click ▶ Run in Xcode (or ⌘+R if it's already open)
```

For **fast iteration**, you can point Capacitor at your local dev
server instead of rebuilding — temporarily add a `server` block to
`capacitor.config.json`:

```json
"server": {
  "url": "http://192.168.1.X:5173",
  "cleartext": true
}
```

(Replace `192.168.1.X` with your Mac's LAN IP; find it via System
Settings → Network → Details next to Wi-Fi.) Then run `npm run dev`
and `npx cap run ios` — your phone loads the live dev server.

**Remove the `server` block before any beta or production build**, or it'll
keep trying to hit your dev server and the app won't launch off your network.

---

## 7. Pre-submission checklist (for when you're ready to TestFlight)

These all matter at App Store review time but don't block you from
running on your own iPhone. Park them until the app feels stable.

- [ ] App icon — 1024×1024 PNG, no transparency. Use icon.kitchen or
      App Icon Generator to make every size iOS needs. Drop into
      `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.
- [ ] Splash screen — 2732×2732 PNG centered. Same Asset Catalog flow.
      The `capacitor.config.json` already sets the splash background
      color to KnockIQ brand blue (`#1B4FCC`).
- [ ] Marketing screenshots — iPhone 6.7" (1290×2796), iPhone 6.5"
      (1242×2688). At least 3 per device.
- [ ] Privacy policy URL — required field on the App Store listing.
      Host at `getknockiq.com/privacy` (or wherever). Must specifically
      disclose location, contact info, and photo collection.
- [ ] App description, keywords, category (Business or Productivity).
- [ ] Demo account credentials for Apple's reviewer — create a
      `apple-reviewer@getknockiq.com` org with a test team pre-loaded
      so the reviewer can log in without going through your real
      onboarding.
- [ ] **Background location justification** — in App Store Connect
      under "App Privacy", explicitly state: *"Background location is
      used during active canvassing sessions to record the rep's
      route. Tracking is started manually by the rep when a session
      begins and stops automatically when the session ends. No
      passive or always-on tracking."* Reviewers specifically look
      for this language.

---

## 8. Common errors and what they actually mean

| Xcode error | What's actually wrong |
|---|---|
| "Failed to register bundle identifier" | Team isn't selected, or the bundle ID is already registered to another team. Check Signing & Capabilities. |
| "Pod install failed" | Run `cd ios/App && pod install --repo-update` manually. Sometimes Capacitor's wrapper doesn't refresh the CocoaPods spec repo. |
| "Untrusted developer" on the phone | See step 5.6 above. |
| App launches then immediately crashes with no error | Almost always a missing Info.plist usage description. iOS silently kills apps that touch a protected API without declaring it. Check Xcode console for the specific permission key it wanted. |
| GPS works in foreground but stops when locked | Background Modes → "Location updates" not checked in step 3, OR the rep granted "While Using App" not "Always Allow" in step 5.7. |
| `npx cap sync ios` says plugin not found | `npm install` didn't complete cleanly. Delete `node_modules/`, re-run `npm install`, re-run `npx cap sync ios`. |
| Web `npm run build` fails with `Failed to resolve entry for package '@capacitor-community/background-geolocation'` | Pre-solved in `vite.config.js` + `src/lib/gps.js`. If it ever resurfaces, confirm those files weren't reverted. |

---

## 9. What's actually in the repo for iOS

These are the files in this repo that make the iOS build work. You
shouldn't need to touch any of them again unless something specific
changes.

| File | Purpose |
|---|---|
| `package.json` | Capacitor dependencies + `ios:sync` / `ios:open` / `ios:run` scripts. |
| `capacitor.config.json` | Locks in `appId: com.getknockiq.app`, `appName: KnockIQ`, splash + status-bar config. |
| `vite.config.js` | Marks the native-only background-geolocation plugin as `external` so the web build doesn't try to resolve it. |
| `src/lib/gps.js` | `GPSTracker` is platform-aware: native iOS/Android uses `@capacitor-community/background-geolocation` (true CoreLocation, runs when locked); web falls back to `navigator.geolocation`. Same public API as before, so no other source files needed touching. |
| `src/contexts/ViewModeContext.jsx` | Detects the Capacitor WebView UA so managers who also knock get rep view persisted across app restarts on phone. |
| `.gitignore` | Excludes `ios/App/Pods/`, Xcode user state, Android build artifacts. |
| **You will add:** `ios/` | Created by `npx cap add ios` — commit the project files, but `.gitignore` keeps the Pods/derived-data junk out. |
| **You will edit:** `ios/App/App/Info.plist` | Permission strings (section 2) + background-modes array. One-time edit. |
