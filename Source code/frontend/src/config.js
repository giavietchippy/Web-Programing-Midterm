const rc = window.__APP_CONFIG__ || {};

export const config = {
  USE_MOCK_API: rc.USE_MOCK_API ?? true,
  // Member 2's /admin/* HTTP API + /ws/admin feed. Defaults to the same mode as USE_MOCK_API;
  // set it to false (with USE_MOCK_API=true) to try the real real-time server with a fake REST backend.
  USE_MOCK_ADMIN: rc.USE_MOCK_ADMIN ?? rc.USE_MOCK_API ?? true,
  API_BASE: rc.API_BASE || '/api',
  // Browser path that is forwarded to the real-time server's /admin/* (nginx/Vite strip the "/realtime" prefix).
  // It is NOT "/admin", because that path is the SPA's own admin area.
  RT_ADMIN_BASE: rc.RT_ADMIN_BASE || '/realtime/admin',
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

// ws://host/ws/admin?token=<JWT>  (admin live feed, P2)
export function buildAdminWsUrl(token) {
  const base = config.WS_URL
    ? config.WS_URL.replace(/\/ws\/?$/, '') + '/ws/admin'
    : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/admin`;
  return `${base}?token=${encodeURIComponent(token)}`;
}
