#!/bin/sh

# Xcode Cloud — post-clone build prep for the KnockIQ Capacitor app.
#
# Xcode Cloud runs this script right after it clones the repo and BEFORE it
# resolves the Xcode project / CocoaPods. Without it, the archive fails with:
#
#   Unable to open base configuration reference file
#   '.../Pods/Target Support Files/Pods-App/Pods-App.release.xcconfig'
#
# ...because Pods/ is git-ignored (correctly) and the web bundle isn't built in
# CI. This script builds the web app, syncs it into the iOS project, and
# installs CocoaPods so the xcconfig files exist before xcodebuild runs.
#
# Apple looks for this file at ios/App/ci_scripts/ci_post_clone.sh (same folder
# as App.xcworkspace). It must be executable: `chmod +x`.

set -e

# Xcode Cloud clones the repo to $CI_PRIMARY_REPOSITORY_PATH (repo root).
cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "▶︎ Installing Node (not preinstalled on Xcode Cloud images)…"
brew install node

echo "▶︎ Installing JS dependencies…"
npm ci

echo "▶︎ Building the web app (vite → dist/)…"
npm run build

echo "▶︎ Syncing web assets + plugins into the iOS project…"
npx cap sync ios

# cap sync already runs `pod install`, but do it explicitly as a safety net in
# case the CI image's CocoaPods needs a repo refresh.
echo "▶︎ Ensuring CocoaPods are installed…"
cd ios/App
pod install || pod install --repo-update

echo "✅ Post-clone prep complete."
