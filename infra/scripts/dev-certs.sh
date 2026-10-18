#!/usr/bin/env sh
# Self-signed certificate for local runs of the production stack (app.localhost and localhost).
# Browsers will warn once; production mounts real certificates at infra/nginx/certs instead.
set -eu
DIR="$(cd "$(dirname "$0")/../nginx" && pwd)/certs"
mkdir -p "$DIR"
if [ -f "$DIR/fullchain.pem" ] && [ "${1:-}" != "--force" ]; then
  echo "Certificates already exist in $DIR (pass --force to replace)."
  exit 0
fi
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
  -subj "/CN=app.localhost" \
  -addext "subjectAltName=DNS:app.localhost,DNS:localhost,IP:127.0.0.1"
echo "Wrote $DIR/fullchain.pem and privkey.pem"
