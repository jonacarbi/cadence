#!/bin/bash
# Headless service for launchd: publishes on schedule even when the app window is closed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
cd "$ROOT/server"
exec node --no-warnings src/index.js
