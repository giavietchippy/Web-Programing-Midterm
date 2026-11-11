const rc = window.__APP_CONFIG__ || {};

export const config = {
  USE_MOCK_API: rc.USE_MOCK_API ?? true,
  API_BASE: rc.API_BASE || '/api',
  WS_URL: rc.WS_URL || '',
  DEV_TOKEN_URL: rc.DEV_TOKEN_URL || '/dev/token'
};

// Used when GET /config/ice is unavailable (mock mode or backend down).
export const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// token-contract.md: ws://host/ws?token=<JWT>  (wss:// when the page is https)
export function buildWsUrl(token) {
  const base =
    config.WS_URL ||
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  return `${base}?token=${encodeURIComponent(token)}`;
}
