#!/bin/sh
# Start Cadence at login (launchd on macOS, systemd --user on Linux). Same as: cadence service install
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node --no-warnings "$ROOT/server/bin/cadence.mjs" service "${1:-install}"
