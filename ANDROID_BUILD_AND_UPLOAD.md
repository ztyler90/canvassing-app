# Android Build & Upload to Google Play Internal Testing

Everything in Google Play Console is done — all 11 App content declarations, the Data safety wizard, App category, contact details, and the full store listing (icon, feature graphic, 5 phone screenshots, 5 tablet screenshots). What's left is generating a signed Android App Bundle (AAB) and uploading it to the Internal Testing track. Do this from your Mac (the sandbox can't run Android Studio or push to .git).

## 1. Generate an upload keystore (ONE TIME)

This signs every release going forward. Lose it and you can't ship updates — back it up.

```bash
cd ~/Documents/Claude/outputs/canvassing-app
keytool -genkey -v \
  -keystore android/knockiq-upload.keystore \
  -alias knockiq \
  -keyalg RSA -keysize 2048 -validity 25000
```

When prompted:
- Keystore password: pick a strong one, save in 1Password
- First and last name: `Knock IQ LLC`
- Organizational unit: leave blank or `Engineering`
- Organization: `Knock IQ LLC`
- City, State, Country: your business address
- Key password: same as keystore password (simpler)

**Back this file up immediately.** Copy `knockiq-upload.keystore` to 1Password as a secure attachment. If this file is lost, Google can reset it via Play App Signing, but it's painful.

Add to `.gitignore` (already there for most repos, double-check):

```
android/knockiq-upload.keystore
android/key.properties
```

## 2. Wire the keystore into Gradle

Create `android/key.properties` (NEVER commit):

```properties
storeFile=knockiq-upload.keystore
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=knockiq
keyPassword=YOUR_KEY_PASSWORD
```

Edit `android/app/build.gradle` — find the `android { }` block and add:

```gradle
// Top of the file, just below "apply plugin: ..."
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    // ... existing config ...

    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false   // Capacitor apps don't need R8 by default
            // ... your existing release config ...
        }
    }
}
```

Bump the version in `android/app/build.gradle` (`defaultConfig`):

```gradle
defaultConfig {
    applicationId "com.getknockiq.knockiq"
    minSdkVersion 23
    targetSdkVersion 34
    versionCode 1        // increment by 1 EVERY upload
    versionName "1.0"    // human-readable
}
```

## 3. Build the AAB

```bash
cd ~/Documents/Claude/outputs/canvassing-app
npm install
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

The signed AAB lands at:

```
android/app/build/outputs/bundle/release/app-release.aab
```

Verify it's signed:

```bash
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab | head -20
```

You should see your CN, O, and SHA-256 fingerprint.

## 4. Upload to Internal Testing

1. Open Play Console → KnockIQ → **Test and release** → **Internal testing**
2. **Create new release** (top right)
3. **Upload** the `app-release.aab` file
4. **Release name:** Play auto-fills "1 (1.0)" — leave it
5. **Release notes:** paste:
   ```
   <en-US>
   Initial Android release of KnockIQ — canvassing for door-to-door sales teams.
   </en-US>
   ```
6. Click **Next**, review the rollout summary, then **Save**
7. **Review release** → **Start rollout to Internal testing**

## 5. Add testers

Internal testing has a max of 100 testers. Use it for yourself + your beta team.

- Under **Internal testing** → **Testers** tab
- **Create email list** → name it "KnockIQ internal", add `ztyler90@gmail.com` and any team Gmails
- Save the **Copy link** for the opt-in URL — testers click it on their Android phone to install

## 6. Promote to Production

Once internal testing is clean (no crashes, login works on a real Android device, GPS background tracking works):

1. **Test and release** → **Production** → **Create new release**
2. **Add from library** → pick the same AAB you uploaded to Internal
3. Same release notes
4. **Review release** → **Start rollout to Production** (or staged 20% first)

Google will review for 1–7 days. After approval the app goes live on Play.

## Common gotchas

- **"Upload version code conflicts with an existing version code"** — bump `versionCode` in `build.gradle` and rebuild.
- **"Signing key mismatch"** — you used the wrong keystore. Internal vs production tracks share signing; once you upload to one track with a key, every future upload must use the same key.
- **"App must target API 34"** — bump `targetSdkVersion 34` in `build.gradle`. Google requires API 34 (Android 14) for new submissions as of Aug 2025.
- **Capacitor plugins missing on Android** — run `npx cap sync android` again. If a plugin was added on iOS only, it may not be in `android/app/src/main/AndroidManifest.xml`.
- **Background location not working on Android** — Android requires a separate "While in use" + "Allow all the time" prompt. The `@capacitor-community/background-geolocation` plugin handles this. Test on a real device, not the emulator.

## What's already in the Play Console

So you know what NOT to redo:

- Privacy policy: `https://getknockiq.com/privacy`
- Sign-in details: declared (test account already in App access)
- Ads: No
- Content rating: Everyone (IARC)
- Target audience: 13+
- Data safety: complete (5-step wizard saved)
- Government apps / News / Financial / COVID-19 / Health: all declared
- Advertising ID: No
- App category: Business
- Contact: `hello@knockiq.com` / `+1 813 669 0997` / `https://getknockiq.com`
- App name: KnockIQ
- Short description: "Door-to-door canvassing for sales teams — track knocks, leads, and bookings."
- Full description: 2101 chars saved (mirrors the iOS App Store copy)
- App icon: 512x512 from `public/icon-512.png`
- Feature graphic: 1024x500 in `android-play-assets/feature-graphic-1024x500.png`
- Phone screenshots: 5 at 1080x1920 in `android-play-assets/phone-screenshots/`
- 10-inch tablet screenshots: 5 at 2064x2752 in `appstore-screenshots/iPad-13/`

The whole store listing is in "Default — English (United States) — en-US". Adding other locales later just means filling description fields, not re-uploading graphics.
