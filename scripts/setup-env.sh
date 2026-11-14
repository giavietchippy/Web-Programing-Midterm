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
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  admin_password=$ADMIN_PASSWORD
  admin_password_bytes=$(printf '%s' "$admin_password" | wc -c | tr -d '[:space:]')
  newline='
'
  carriage_return=$(printf '\r')
  case "$admin_password" in
    *"'"*|*"$newline"*|*"$carriage_return"*)
      echo 'ADMIN_PASSWORD cannot include quotes or line breaks.' >&2
      exit 1 ;;
  esac
  case "$admin_password_bytes" in
    ''|*[!0-9]*)
      echo 'Could not validate ADMIN_PASSWORD length.' >&2
      exit 1 ;;
  esac
  if [ "$admin_password_bytes" -lt 8 ] || [ "$admin_password_bytes" -gt 72 ]; then
    echo 'ADMIN_PASSWORD must be 8-72 UTF-8 bytes.' >&2
    exit 1
  fi
  admin_password_line="ADMIN_PASSWORD='$admin_password'"
else
  admin_password=$(new_secret)
  admin_password_line="ADMIN_PASSWORD=$admin_password"
fi

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
      printf '%s\n' "$admin_password_line" ;;
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
