# Member 3 test results (in isolated environment, 2026-11-14)

- `node scripts/integration-test.cjs` -> `INTEGRATION PASS` (7 groups)
- `node scripts/session-version-test.cjs` -> `SESSION VERSION TEST PASS` (repeated role changes, reset/revoke, recovery)
- `node scripts/turn-config-test.cjs` -> `TURN CONFIG TEST PASS` (HMAC-SHA1 credential, time-limited username, `turn:` UDP/TCP, no `turns:` 5349 default)
- `node --check platform/server.js` and `node --check realtime/server.js` -> PASS
- Docker Compose parsed as YAML with 5 services.

**NOT RUN:** Docker Compose containers (no Docker binary in build environment), Nginx live HTTPS handshake, TURN allocate/relay against a running coturn, 2-browser media call, or React production build. These must be verified by the student on Windows/VPS before claiming completion.

The patch intentionally contains no actual secrets, personal database, or TLS private keys.
