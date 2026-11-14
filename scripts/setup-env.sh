#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DEST="$REPO_ROOT/.env"
EXAMPLE="$REPO_ROOT/.env.example"

if [ -e "$DEST" ]; then
  echo 'Root .env already exists; refusing to overwrite secrets.' >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo 'OpenSSL is required to generate .env secrets.' >&2
  exit 1
fi

new_secret() {
  openssl rand -hex 32
}

jwt_secret=$(new_secret)
internal_api_key=$(new_secret)
turn_secret=$(new_secret)
admin_password=$(new_secret)

umask 077
tmp=$(mktemp "$DEST.tmp.XXXXXX")
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    JWT_SECRET=REPLACE_WITH_NEW_RANDOM_JWT_SECRET_AT_LEAST_24_CHARS)
      printf 'JWT_SECRET=%s\n' "$jwt_secret" ;;
    INTERNAL_API_KEY=REPLACE_WITH_NEW_RANDOM_INTERNAL_KEY_AT_LEAST_24_CHARS)
      printf 'INTERNAL_API_KEY=%s\n' "$internal_api_key" ;;
    TURN_SECRET=REPLACE_WITH_NEW_RANDOM_TURN_SECRET_AT_LEAST_24_CHARS)
      printf 'TURN_SECRET=%s\n' "$turn_secret" ;;
    ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD)
      printf 'ADMIN_PASSWORD=%s\n' "$admin_password" ;;
    *)
      printf '%s\n' "$line" ;;
  esac
done < "$EXAMPLE" > "$tmp"

if ! ln "$tmp" "$DEST"; then
  echo 'Could not create root .env; refusing to overwrite an existing file.' >&2
  exit 1
fi

printf 'Created %s with random secrets (not printed).\n' "$DEST"
printf '%s\n' 'NEXT: edit TURN_HOST and TURN_EXTERNAL_IP in root .env to YOUR reachable Windows/VPS IPv4 address.'
printf '%s\n' 'Run ipconfig in PowerShell to find Windows LAN IPv4. Keep .env private.'
