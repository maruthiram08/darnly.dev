#!/bin/bash
# Builds Darnly.app (menu bar app) from the Swift package. Run on a Mac: ./scripts/make-app.sh
# Signed ad hoc by default (runs on this Mac). Set DARNLY_SIGN_ID to sign with a Developer ID; make-dmg.sh does that.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${DARNLY_VERSION:-0.1.0}"
swift build -c release --arch arm64 --arch x86_64
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/Darnly"
APP="build/Darnly.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Darnly"
# App icon (Finder, Dock, Applications, the DMG): AppIcon.icns built from Resources/AppIcon.png (1024x1024).
ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size Resources/AppIcon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) Resources/AppIcon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Darnly</string>
  <key>CFBundleDisplayName</key><string>Darnly</string>
  <key>CFBundleIdentifier</key><string>dev.darnly.mac</string>
  <key>CFBundleExecutable</key><string>Darnly</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
if [ -n "${DARNLY_SIGN_ID:-}" ]; then
  # Developer ID signing for sharing (see make-dmg.sh): hardened runtime and a secure timestamp, as notarization needs.
  codesign --force --options runtime --timestamp --sign "$DARNLY_SIGN_ID" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
else
  codesign --force --deep --sign - "$APP"   # ad hoc: fine on this Mac only
fi
(cd build && ditto -c -k --keepParent Darnly.app Darnly-mac-${VERSION}.zip)
echo "Built $APP and build/Darnly-mac-${VERSION}.zip"
