#!/bin/sh
# Headless run (macOS/Linux): publishes on schedule with no window open. Service managers: use "cadence service install".
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/server"
exec node --no-warnings bin/cadence.mjs start
