#!/bin/bash
# Builds Darnly.app (menu bar app) from the Swift package. Run on a Mac: ./scripts/make-app.sh
# The result is unsigned (ad-hoc). Signing and notarizing come with the Apple Developer account.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${DARNLY_VERSION:-0.1.0}"
swift build -c release --arch arm64 --arch x86_64
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/Darnly"
APP="build/Darnly.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Darnly"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Darnly</string>
  <key>CFBundleDisplayName</key><string>Darnly</string>
  <key>CFBundleIdentifier</key><string>dev.darnly.mac</string>
  <key>CFBundleExecutable</key><string>Darnly</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
(cd build && ditto -c -k --keepParent Darnly.app Darnly-mac-${VERSION}.zip)
echo "Built $APP and build/Darnly-mac-${VERSION}.zip"
