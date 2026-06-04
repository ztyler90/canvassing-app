# KnockIQ iOS Setup Guide

End-to-end checklist for going from this repo on your Mac to the app
running on your iPhone, then on TestFlight, then on the App Store.

Bundle ID: `com.getknockiq.app`
App name: `KnockIQ`
Background GPS: enabled (uses `@capacitor-community/background-geolocation`)

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
# If that errors on newer macOS, use Homebrew instead:
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

`npm install` will pick up the new Capacitor packages we just added
(`@capacitor/core`, `@capacitor/ios`, `@capacitor/geolocation`,
`@capacitor-community/background-geolocation`, plus the CLI).

### 1c. Add the iOS platform
This creates the `ios/` directory with a real Xcode project inside.
**Run this once, then check the entire `ios/` folder into git** so future
syncs don't recreate it from scratch.

```bash
npx cap add ios
```

You should see a new `ios/App/App.xcworkspace` file. That's the file you'll
open in Xcode — not the `.xcodeproj`. Always open the workspace, never the
project, or CocoaPods dependencies won't resolve.

### 1d. First sync
```bash
npm run build       # builds the web app into dist/
npx cap sync ios    # copies dist/ into the iOS project and links native plugins
```

`npx cap sync ios` runs `pod install` under the hood, which downloads the
native dependencies for the geolocation plugins. The first run takes a
minute or two.

---

## 2. Info.plist additions

Apple requires a human-readable explanation for every permission the app
asks for. Missing or vague strings = guaranteed App Store rejection.

Open `ios/App/App/Info.plist` in Xcode (or any text editor — it's XML)
and add these keys inside the top-level `<dict>`. The wording below is
already calibrated for Apple's reviewers — they want concrete, specific
language tied to the app's actual function.

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>KnockIQ uses your location to map the route you walk while canvassing, so your manager can see coverage and reps can see their door history.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>KnockIQ tracks your canvassing route in the background so your session keeps recording when your phone locks or you switch apps. Tracking only runs while a canvassing session is active — it stops automatically when you end the session.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>KnockIQ tracks your canvassing route in the background so your session keeps recording when your phone locks or you switch apps. Tracking only runs while a canvassing session is active.</string>

<key>NSCameraUsageDescription</key>
<string>KnockIQ uses the camera to attach photos to booked jobs (before-and-after shots of windows, gutters, roofs, etc.) and to capture estimate-request documentation.</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>KnockIQ accesses your photo library so you can attach existing photos to a job booking.</string>

<key>NSPhotoLibraryAddUsageDescription</key>
<string>KnockIQ saves job photos to your library when you choose to export them.</string>

<key>NSMicrophoneUsageDescription</key>
<string>KnockIQ uses the microphone to capture voice notes for each door interaction, which are automatically transcribed into your session log.</string>

<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
</array>
```

The `UIBackgroundModes` → `location` entry is what actually lets iOS keep
delivering GPS updates to the app after the screen locks. Without it,
the background-geolocation plugin can't run.

`fetch` is optional — it allows occasional background data refresh
(e.g. flushing the GPS buffer to Supabase if the rep's connection
flapped). Including it doesn't trigger any extra review scrutiny.

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

1. Open the workspace: `npx cap open ios`
2. Click the **App** target in the left sidebar (top item under "App").
3. Go to **Signing & Capabilities** tab.
4. Click **+ Capability** → choose **Background Modes**.
5. In the Background Modes box that appears, check **Location updates**.

This adds an entitlement that tells the OS "yes, this app is allowed to
keep running for location updates."

---

## 4. Signing — connecting the project to your Apple Developer account

Still in **Signing & Capabilities**:

1. **Team**: from the dropdown, select your KnockIQ LLC team (the one
   tied to the Apple Developer account that got approved). If you don't
   see it, sign into Xcode → Settings → Accounts with the Apple ID
   you used for the Developer Program enrollment.
2. **Bundle Identifier**: confirm it reads `com.getknockiq.app`. If
   it shows anything else, change it here — and update `capacitor.config.json`
   to match before the next sync.
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
   click the device dropdown and select your iPhone. (Not a
   simulator — simulators can't test GPS or background tracking
   meaningfully.)
4. Click the **▶ Run** button (or `⌘ + R`).
5. First build takes 1–3 minutes (compiling native plugins, etc.).
   Subsequent builds are much faster.
6. The first time the app launches on your phone, iOS will show
   **"Untrusted Developer"** and refuse to open it. To fix:
   - On the iPhone, go to **Settings → General → VPN & Device
     Management** (older iOS: **Profiles & Device Management**).
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
npm run build          # rebuild the web bundle
npx cap sync ios       # push changes into the iOS project
npx cap open ios       # (only needed if not already open)
# Click ▶ Run in Xcode
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
Settings → Network.) Then run `npm run dev` and `npx cap run ios` —
your phone loads the live dev server. **Remove the `server` block
before shipping or beta builds**, or it'll keep trying to hit your dev
server.

---

## 7. Pre-submission checklist (for when you're ready to TestFlight)

These all matter at App Store review time but don't block you from
running on your own iPhone. Park them until the app feels stable.

- [ ] App icon — 1024×1024 PNG, no transparency. Use icon.kitchen or
      App Icon Generator to make every size iOS needs. Drop into
      `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.
- [ ] Splash screen — 2732×2732 PNG centered. Same Asset Catalog flow.
- [ ] Marketing screenshots — iPhone 6.7" (1290×2796), iPhone 6.5"
      (1242×2688). At least 3 per device.
- [ ] Privacy policy URL — required field on the App Store listing.
      Host at `getknockiq.com/privacy`. Must specifically disclose
      location, contact info, and photo collection.
- [ ] App description, keywords, category (Business or Productivity).
- [ ] Demo account credentials — reviewers will use this to log in.
      Create a `apple-reviewer@getknockiq.com` account with a test org
      pre-populated so they don't have to onboard.
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
| App launches then immediately crashes with no error | Almost always a missing Info.plist usage description. iOS silently kills apps that touch a protected API without declaring it. Check Xcode console for the specific permission key. |
| GPS works in foreground but stops when locked | Background Modes → Location updates not checked (step 3), OR the rep granted "While Using App" not "Always Allow". |
| `npx cap sync ios` says plugin not found | `npm install` didn't complete cleanly. Delete `node_modules/`, re-run `npm install`, re-run `npx cap sync ios`. |

---

## 9. What changed in the codebase

- `package.json` — added Capacitor dependencies and `ios:*` npm scripts.
- `capacitor.config.json` — new, declares app ID, name, web dir, and
  plugin config.
- `src/lib/gps.js` — rewrote `GPSTracker` to use the native
  background-geolocation plugin when running on iOS/Android, fall back
  to `navigator.geolocation` on web. Public API
  (`gpsTracker.start/stop/setMode/getLastPosition`,
  `requestGPSPermission`, `distanceMeters`) is unchanged, so no other
  file needs touching.

Everything else — managers on desktop, the Supabase data layer, the
rest of the React UI — runs exactly as before.
