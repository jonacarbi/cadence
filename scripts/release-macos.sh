#!/bin/bash
# Developer ID signing, notarization and a distributable DMG.
#
# The local build is ad-hoc signed, which is fine on the machine that built it and refused everywhere
# else. This turns the same bundle into something another Mac will open. It needs two things from you:
#
#   DEVELOPER_ID   "Developer ID Application: Your Name (TEAMID)" — see `security find-identity -v -p codesigning`
#   NOTARY_PROFILE a keychain profile name, created once with:
#                  xcrun notarytool store-credentials "cadence" --apple-id <id> --team-id <team> --password <app-specific-password>
#
# Neither is stored in this repo, and neither is printed. Run: scripts/release-macos.sh
set -euo pipefail
CADENCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$CADENCE_ROOT/build/Cadence.app"
DMG="$CADENCE_ROOT/build/Cadence.dmg"
ENTITLEMENTS="$CADENCE_ROOT/build/cadence.entitlements"

: "${DEVELOPER_ID:?Set DEVELOPER_ID to your Developer ID Application identity}"
: "${NOTARY_PROFILE:=cadence}"
xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
  || { echo "No notarytool credentials under profile '$NOTARY_PROFILE'. See the header of this script." >&2; exit 1; }

"$CADENCE_ROOT/scripts/build-macos.sh"

# The bundled Node runs the server as a child process and JIT-compiles it, so it needs the JIT and
# unsigned-memory exceptions; without them the hardened runtime kills it at launch.
cat > "$ENTITLEMENTS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.network.server</key><true/>
</dict></plist>
PLIST

# Inside out: a nested binary signed after its container invalidates the container's signature.
while IFS= read -r binary; do
  codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$DEVELOPER_ID" "$binary"
done < <(find "$APP/Contents/Resources" -type f \( -name '*.dylib' -o -name '*.node' -o -name 'node' \) -o -type f -perm +111 -name '*.sh' | sort -r)
codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$DEVELOPER_ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

rm -f "$DMG"
hdiutil create -volname Cadence -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null
codesign --force --timestamp --sign "$DEVELOPER_ID" "$DMG"

xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler staple "$APP"
# What Gatekeeper on someone else's Mac will say. Anything but "accepted" means it would be refused.
spctl --assess --type execute --verbose=4 "$APP"
printf 'Signed and notarized: %s\n' "$DMG"
