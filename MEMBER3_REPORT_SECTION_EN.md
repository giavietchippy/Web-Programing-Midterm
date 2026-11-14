# Platform Backend, NAT Traversal and Deployment (Member 3)

> Suggested text for the **Implementation** and **Testing** chapters of the group's English Midterm report. Add only screenshots and claims you actually verify on your own system; do not claim coturn or HTTPS production deployment worked without testing.

## Architecture and responsibilities

The WebRTC meeting application separates platform operations from signaling. The Platform service, implemented with Node.js and SQLite, manages accounts, roles, JWT authentication, persistent rooms and server-side chat history. The Real-time service handles WebSocket connections, room presence and SDP/ICE signaling. The React frontend communicates with the Platform through HTTP REST endpoints and with Real-time through WebSocket. Once negotiation succeeds, audio, video and P2P data are transported through WebRTC rather than through the REST server.

The Platform and Real-time services have separate internal API endpoints protected by a shared internal key. Real-time validates persistent room existence before creating live room state, and it sends server-chat messages to Platform for persistence. When a room is deleted or a user's access changes, Platform informs the Real-time service to close the room or revoke that user's active sessions.

## Authentication and session revocation

Users authenticate through `POST /api/login`, which issues an HS256 JWT. In addition to the user ID, username, role and expiration time, the token includes a `sessionVersion`. The Platform stores the current version in SQLite and rejects tokens whose version no longer matches. The version increments after sensitive changes such as password resets or permission changes. A corresponding internal revoke request communicates the minimum acceptable session version to Real-time so that older WebSockets are closed. Revoke events are recorded for retry when the services are temporarily disconnected. This approach avoids ambiguity caused by comparing JWT issuance timestamps with second-level precision.

## STUN/TURN configuration

Browsers request ICE server settings through `GET /api/config/ice`. The Platform generates time-limited TURN REST API credentials using an expiry-based username and `base64(HMAC-SHA1(TURN_SECRET, username))`. The same secret is supplied to the coturn container with `use-auth-secret` and `static-auth-secret`. The demo configuration advertises TURN UDP/TCP on port 3478; TURN-over-TLS (`turns:` on port 5349) is intentionally not advertised, because the coturn container has no TURN TLS certificate. The web application's HTTPS configuration is independent of TURN TLS.

## Container deployment and HTTPS

The root Docker Compose file describes five services: Platform, Real-time, Frontend, coturn and a public Nginx gateway. Platform and Real-time share an isolated Docker network, while only Nginx and coturn publish host ports. Nginx terminates HTTPS for the browser, forwards `/api/` requests to Platform, forwards `/ws` signaling and `/realtime/` administration requests to Real-time, and denies public `/internal/` and `/dev/` routes. In local testing, Nginx can use a temporary self-signed certificate. A public deployment requires a properly validated CA certificate, a reachable TURN public IP and appropriately opened UDP relay ports. SQLite data is persisted in a Docker named volume.

## Test plan and evidence

| Scenario | Expected outcome | Screenshot to include |
|---|---|---|
| Register and login | User receives JWT and enters lobby | Login and lobby |
| Room management | Room created, persists after restart and can be deleted | Room list and API result |
| Chat history | WebSocket chat appears after rejoin; P2P chat is not stored | Chat panel |
| Admin revocation | Old JWT rejected on REST and Real-time after reset/block | Admin users + Network error |
| Nginx HTTPS | Browser uses HTTPS and WSS; internal endpoints are inaccessible | Address bar + Network tab |
| TURN credential API | Contains `turn:` 3478 URLs with temporary credentials; no unsupported `turns:` 5349 | Sanitized ICE response |
| TURN relay | With Force TURN, selected candidate pair has `relay` and call succeeds | ICE stats + two connected peers |

## Verified automated checks in the prepared source

The following isolated Node.js tests were executed during preparation of the integration patch: `integration-test.cjs` (seven core backend scenarios), `session-version-test.cjs` (repeated role changes, password resets, revoke replay) and `turn-config-test.cjs` (time-limited HMAC-SHA1 credentials, expected URLs without TLS). These tests do **not** establish that coturn relaying works over a public network, nor do they replace manual browser/HTTPS checks. Actual deployment results and screenshots must be added after running the containers on the team's machine.

## Limitations and future work

The demo defaults to TURN over UDP/TCP port 3478 and does not configure TURN over TLS port 5349. Some restrictive enterprise networks may therefore prevent successful relay until TURN TLS with a valid certificate is added. Public deployment also requires a valid HTTPS certificate, external IP/NAT configuration and firewall rules. The SQLite storage and single-instance signaling design are appropriate for a course demonstration but would require further scaling, monitoring and resilience planning for production use.
