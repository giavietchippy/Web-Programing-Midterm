// Runtime config (loaded before the app). In Docker this file is regenerated
// at container start from environment variables (see docker/40-runtime-config.sh).
window.__APP_CONFIG__ = {
  USE_MOCK_API: true,         // true = fake REST data (until Member 3's API is ready)
  USE_MOCK_ADMIN: false,       // true = fake /admin/* data (Member 2) + fake /api/admin/users (Member 3)
  RT_ADMIN_BASE: "/realtime/admin", // browser path forwarded to the real-time server's /admin/* (prefix "/realtime" is stripped)
  API_BASE: "/api",           // REST base path
  WS_URL: "",                 // "" = same origin "/ws"; or e.g. "ws://localhost:3001/ws"
  DEV_TOKEN_URL: "/dev/token" // Member 2's dev-only token endpoint (used by mock login)
};
