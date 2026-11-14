#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CERT_DIR="$REPO_ROOT/deploy/certs"
FULLCHAIN="$CERT_DIR/fullchain.pem"
PRIVKEY="$CERT_DIR/privkey.pem"

if [ -e "$FULLCHAIN" ] || [ -e "$PRIVKEY" ]; then
  echo "Certificate files already exist. Back up or remove both before regeneration." >&2
  exit 1
fi

umask 077
mkdir -p "$CERT_DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$PRIVKEY" \
  -out "$FULLCHAIN" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Generated self-signed 365-day certificate for localhost."
