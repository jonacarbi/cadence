#!/bin/sh
# (Re)create the self-signed cert for the https://localhost:PORT+1 sign-in callback (Instagram, Facebook, Threads, TikTok).
# Cadence also does this on first start; run this to renew or to see how to trust it on this OS.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/server"
node --no-warnings --input-type=module -e "
const { ensureCert, trustHint } = await import('./src/tls.js');
const r = ensureCert({ force: true });
if (!r.ok) { console.error(r.error); process.exit(1); }
console.log('Certificate written. To make your browser trust it:\n' + trustHint());
"
