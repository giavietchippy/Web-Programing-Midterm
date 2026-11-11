#!/bin/sh
# Generates /config.js from environment variables every time the container starts,
# so you can switch mock/real mode WITHOUT rebuilding the image.
set -e
cat > /usr/share/nginx/html/config.js <<CFG_END
window.__APP_CONFIG__ = {
  USE_MOCK_API: ${USE_MOCK_API:-true},
  API_BASE: "${API_BASE:-/api}",
  WS_URL: "${WS_URL:-}",
  DEV_TOKEN_URL: "${DEV_TOKEN_URL:-/dev/token}"
};
CFG_END
echo "[runtime-config] USE_MOCK_API=${USE_MOCK_API:-true} API_BASE=${API_BASE:-/api}"
