# Member 3 Platform Backend

Requires Node.js >=22.13 (built-in `node:sqlite`; no npm dependencies). Note Node 22 emits an experimental SQLite warning; use an appropriate stabilized version for production.

1. Copy `.env.example` to `.env`. Set `JWT_SECRET`, `INTERNAL_API_KEY`, and `ADMIN_PASSWORD` to strong, different values; set the same JWT and internal keys in `realtime/.env`.
2. Start `node server.js` in `platform/`. Runs on http://localhost:3000 by default.
3. Start the real-time server on port 3001. Then frontend on port 5173, setting `USE_MOCK_API=false` / `USE_MOCK_ADMIN=false` in `frontend/public/config.js`.
4. Login as `ADMIN_USERNAME`/`ADMIN_PASSWORD` (seeded on first startup).

SQLite db stored in `data/platform.sqlite` (ignored by Git).
All internal endpoints require `X-Internal-Key`. Do not publish `/internal/*` through Nginx.
TURN credentials are available when TURN_HOST and TURN_SECRET are set. Without them, local development returns STUN-only config; production returns 503.
Implementation uses `crypto.scrypt` for password hashing (salted, secure), not bcrypt; the contract documents this explicitly.

See `/HUONG_DAN_MEMBER3_TICH_HOP.md` supplied alongside the ZIP for Windows setup, file-by-file changes, and integration tests.
