#!/bin/bash
# Builds a signed, notarized Darnly.dmg that opens on any Mac without warnings. Run on a Mac:
#   ./scripts/make-dmg.sh
# Needs, once (see mac/README.md, "Share it"):
#   - a "Developer ID Application" certificate in your keychain
#   - notarytool credentials saved under the name "darnly":
#       xcrun notarytool store-credentials darnly --apple-id <you> --team-id <TEAMID> --password <app-specific password>
# Options: DARNLY_VERSION=0.2.0, DARNLY_SIGN_ID="Developer ID Application: Name (TEAMID)", DARNLY_NOTARY_PROFILE=darnly
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${DARNLY_VERSION:-0.2.0}"
PROFILE="${DARNLY_NOTARY_PROFILE:-darnly}"

if [ -z "${DARNLY_SIGN_ID:-}" ]; then
  DARNLY_SIGN_ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)"
fi
if [ -z "$DARNLY_SIGN_ID" ]; then
  echo "No 'Developer ID Application' certificate found in your keychain."
  echo "Create one in Xcode: Settings > Accounts > your team > Manage Certificates > + > Developer ID Application."
  exit 1
fi
if ! xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1; then
  echo "No notarytool credentials named '$PROFILE'. Save them once with:"
  echo "  xcrun notarytool store-credentials $PROFILE --apple-id <your Apple ID email> --team-id <TEAMID> --password <app-specific password>"
  exit 1
fi
echo "Signing as: $DARNLY_SIGN_ID"

DARNLY_SIGN_ID="$DARNLY_SIGN_ID" DARNLY_VERSION="$VERSION" ./scripts/make-app.sh

# The disk image: the app plus a shortcut to Applications to drag it onto.
DMG="build/Darnly-${VERSION}.dmg"
STAGE="$(mktemp -d)"
cp -R build/Darnly.app "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "Darnly" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
codesign --force --timestamp --sign "$DARNLY_SIGN_ID" "$DMG"

echo "Sending to Apple for notarization (usually a few minutes)…"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
# The website's "Download for Mac" button serves site/download/Darnly.dmg (darnly.dev/download/Darnly.dmg).
mkdir -p ../site/download
cp "$DMG" ../site/download/Darnly.dmg
echo "Done: $DMG (signed and notarized; share this file)"
echo "Also copied to site/download/Darnly.dmg. To update the website download, commit and push it:"
echo "  git add ../site/download/Darnly.dmg && git commit -m \"Mac app ${VERSION}\" && git push"
