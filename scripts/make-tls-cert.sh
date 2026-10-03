#!/bin/bash
# Self-signed cert for https://localhost:8797 (OAuth callback). Trusted in the login keychain so browsers accept it.
set -euo pipefail
DIR="$HOME/Library/Application Support/Cadence/tls"
mkdir -p "$DIR" && chmod 700 "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -addext "extendedKeyUsage=serverAuth" \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem"
chmod 600 "$DIR/key.pem"
security add-trusted-cert -r trustRoot -p ssl -k "$HOME/Library/Keychains/login.keychain-db" "$DIR/cert.pem"
launchctl kickstart -k "gui/$(id -u)/com.jonacarbi.cadence"
echo "Done: https://localhost:8797/oauth/callback"
