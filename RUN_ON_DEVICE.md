# Run KnockIQ on your iPhone (development build)

This installs the app **directly onto your phone from Xcode** for testing — no
TestFlight, no App Store, and it does **not** touch the build currently in
App Store review. Use it to verify the latest fixes before you submit a new
version.

## What you need (one-time)
- A Mac with **Xcode** installed.
- Your Apple Developer account added to Xcode: **Xcode → Settings → Accounts → +**.
  (Your project already has the team `BJMQM7CA89` set, so signing should just work.)
- Your iPhone + a cable.

## Build & install (every time you want the latest code)

1. **Get the latest code.** In Terminal, in the project folder:
   ```sh
   git pull
   npm install        # only needed if dependencies changed; harmless otherwise
   ```

2. **Build the web app, sync it into iOS, and open Xcode** — one command:
   ```sh
   npm run ios:run
   ```
   This runs `vite build` → `cap sync ios` (copies the web build + installs
   CocoaPods) → opens the project in Xcode.

   > If it stops on a CocoaPods error, run `cd ios/App && pod install --repo-update`,
   > then `npm run ios:open`, and continue below.

3. **In Xcode:**
   1. Plug in your iPhone. Unlock it; if it asks **"Trust This Computer?"**, tap **Trust**.
   2. Top toolbar: click the **run-destination dropdown** (next to the ▶ button) and
      pick **your iPhone** under "iOS Device".
   3. Select the **App** target → **Signing & Capabilities** tab → confirm
      **"Automatically manage signing"** is checked and **Team** is your developer team.
   4. Press **▶ Run** (or **⌘R**). Xcode builds, installs, and launches it on your phone.

4. **First launch only — trust the app on the phone.** If iOS shows
   *"Untrusted Developer,"* go to **Settings → General → VPN & Device Management →**
   tap your developer profile **→ Trust**, then reopen the app.

5. **Grant permissions when prompted:** Location **"Always"** and **Motion & Fitness**.
   Both are required to test route tracking and auto door-detection.

You can now unplug and use the app normally (a paid-account dev build runs for
~1 year before it needs reinstalling).

## What to test (the recent fixes)
1. Stand at a door ~6–8 seconds → a gray "no answer" pin should drop.
2. Walk → pan the map away → tap **Re-center** → keep walking → the map should keep following you.
3. Start a session, **lock the phone**, walk a block, unlock → the route trail should be
   continuous (no gap), and a manager watching **Live** should have seen the pin move.
4. End a session right after locking → confirm no points are missing from the end of the route.
5. Settings → Plans → try switching plans (no charge on accounts without a paid subscription).

---

## When you're ready to submit the next version to the App Store

This is separate from the on-device testing above.

- **Bump the build number** so it's higher than the build in review. In Xcode:
  **App target → General → Identity → Build** (and bump **Version**, e.g. `1.0` → `1.0.1`,
  if you want a new public version). Don't submit a new build while the current one is
  still "In Review" unless you mean to replace it.
- **Submitting via Xcode Cloud:** the new `ios/App/ci_scripts/ci_post_clone.sh` makes the
  cloud build install Node + CocoaPods and sync the web bundle, which fixes the
  "Unable to open base configuration reference file …Pods-App.release.xcconfig" failures.
  Make sure the file stays executable in git (`git update-index --chmod=+x ios/App/ci_scripts/ci_post_clone.sh` if needed).
- **Submitting from your Mac instead:** in Xcode, set the destination to **Any iOS Device**,
  then **Product → Archive → Distribute App → App Store Connect**.
