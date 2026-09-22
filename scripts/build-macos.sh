#!/bin/bash
set -euo pipefail
CADENCE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CADENCE_APP="$CADENCE_ROOT/build/.Cadence-stage-$$.app"
trap 'rm -rf "$CADENCE_APP"' EXIT
CADENCE_NODE="${CADENCE_NODE_BIN:-$CADENCE_ROOT/build/runtime-cache/node-v24.21.0-darwin-arm64/bin/node}"
if [[ ! -x "$CADENCE_NODE" && -z "${CADENCE_NODE_BIN:-}" ]]; then
  mkdir -p "$CADENCE_ROOT/build/runtime-cache"
  curl -fsSL https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz -o "$CADENCE_ROOT/build/runtime-cache/node.tar.gz"
  printf '%s  %s\n' bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 "$CADENCE_ROOT/build/runtime-cache/node.tar.gz" | shasum -a 256 -c -
  tar -xzf "$CADENCE_ROOT/build/runtime-cache/node.tar.gz" -C "$CADENCE_ROOT/build/runtime-cache"
fi
if [[ ! -x "$CADENCE_NODE" ]]; then echo 'Node 24+ is required.' >&2; exit 1; fi
swift build --package-path "$CADENCE_ROOT/mac" -c release
# The native app needs the Playwright version's browser even when Chrome is already installed.
(cd "$CADENCE_ROOT/server" && "$CADENCE_NODE" --input-type=module -e 'import {browserExecutable} from "./src/browser.js"; process.exit(browserExecutable()?0:1)' || "$CADENCE_NODE" node_modules/playwright/cli.js install chromium)
mkdir -p "$CADENCE_APP/Contents/MacOS" "$CADENCE_APP/Contents/Resources/runtime" "$CADENCE_APP/Contents/Resources/server"
cp "$CADENCE_ROOT/mac/.build/release/Cadence" "$CADENCE_APP/Contents/MacOS/Cadence"
cp "$CADENCE_NODE" "$CADENCE_APP/Contents/Resources/runtime/node"
if [[ -f "$(dirname "$CADENCE_NODE")/../LICENSE" ]]; then
  cp "$(dirname "$CADENCE_NODE")/../LICENSE" "$CADENCE_APP/Contents/Resources/runtime/NODE-LICENSE.txt"
fi
rsync -a --delete --exclude node_modules --exclude tests "$CADENCE_ROOT/server/" "$CADENCE_APP/Contents/Resources/server/"
(cd "$CADENCE_APP/Contents/Resources/server" && PATH="$(dirname "$CADENCE_NODE"):$PATH" npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)
cat > "$CADENCE_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Cadence</string>
<key>CFBundleIdentifier</key><string>app.cadence.desktop</string>
<key>CFBundleName</key><string>Cadence</string>
<key>CFBundleDisplayName</key><string>Cadence</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$CADENCE_APP/Contents/Resources/runtime/node"
codesign --force --sign - "$CADENCE_APP"
codesign --verify --deep --strict "$CADENCE_APP"
if [[ -d "$CADENCE_ROOT/build/Cadence.app" ]]; then
  mv "$CADENCE_ROOT/build/Cadence.app" "$CADENCE_ROOT/build/Cadence.previous-$$.app"
fi
mv "$CADENCE_APP" "$CADENCE_ROOT/build/Cadence.app"
printf 'Built local development app: %s\n' "$CADENCE_ROOT/build/Cadence.app"
printf 'Ad-hoc signed; public distribution requires Developer ID signing and notarization.\n'
