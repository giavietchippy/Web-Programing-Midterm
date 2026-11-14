# Real-time signaling server

## Requirements

- Node.js LTS and npm
- A local `JWT_SECRET` shared with any platform service that issues tokens
- An `INTERNAL_API_KEY` shared with the platform service and at least 24 characters long

## Start the server

From this directory, install dependencies and create a local environment file:

```powershell
npm install
Copy-Item .env.example .env
```

Set `JWT_SECRET` and `INTERNAL_API_KEY` in `.env` to different private random values and use
the same values in the platform service. `INTERNAL_API_KEY` must be at least 24 characters long.
The supplied `.env.example` sets `PORT=3001`. Never commit `.env` or generated tokens. Start the
server with:

```powershell
npm start
```

With the supplied `.env.example`, the WebSocket endpoint is `ws://localhost:3001/ws` and the
reference client is `http://localhost:3001/realtime/reference-client/`.

## Open the test client and get a development token

Open `http://localhost:3001/realtime/reference-client` in two browser tabs. In each tab, enter a
different username and select **Get token**. The development-only `POST /dev/token` endpoint
returns an HS256 JWT with a random `userId` and one-hour expiration. It is a stand-in for Member
3's `POST /api/login` and is disabled when `NODE_ENV=production`.

```powershell
# Optional: generate a token in the terminal instead
npm run make:test-token -- Alex

# Local admin testing only
npm run make:test-token -- Alex --role admin
```

Enter the same room name in both tabs, select **Join**, and allow camera/microphone access.
Select **Share screen** to test a separate screen stream; stopping it from the browser's sharing
bar also stops the remote stream. Chat is broadcast to everyone in the room.

The client uses Google's public STUN server. Direct peer-to-peer connectivity may not work on
some networks without a TURN server.

## Roles and room permissions

The site role comes only from the verified JWT claim `role` (`user` or `admin`); an omitted
claim is treated as `user`. Never pass a role from a WebSocket message. Room ownership is kept
in server state and tied to `userId`. An admin joining a room is still a participant unless
ownership is explicitly transferred. Owners and admins can update room settings, kick peers,
transfer ownership, and close rooms; owners cannot kick themselves or admins. Administrators
can join locked or full rooms.

Development `POST /dev/token` accepts `{"username":"Alex","role":"admin"}` and is disabled in
production. Admin tokens produced by either development helper are for local testing only.

## Admin API

Pass an admin JWT as `Authorization: Bearer <JWT>`. For example:

```powershell
$token = (npm run --silent make:test-token -- Admin --role admin).Trim()
Invoke-RestMethod http://localhost:3001/admin/stats -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://localhost:3001/admin/rooms -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://localhost:3001/admin/rooms/demo-room/close -Method Post `
  -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } `
  -Body '{"reason":"Meeting ended"}'
Invoke-RestMethod http://localhost:3001/admin/rooms/demo-room/settings -Method Patch `
  -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } `
  -Body '{"chatEnabled":false}'
```

Non-admin tokens receive HTTP 403; missing or invalid tokens receive HTTP 401. Development CORS
is restricted to `http://localhost` origins and is disabled in production.

The API also supports room detail, kick, mute requests, owner transfer and close; live connection
listing; user disconnect/temporary deny; announcements; runtime global config; and filtered audit
queries. See the Admin API table in [the WebSocket contract](../docs/websocket-contract.md).
`/admin/config` manages `maxPeersPerRoom`, `maxRooms`, `maxConnectionsPerUser`, `rateLimit`, and
`defaultRoomSettings`. Lowering `maxPeersPerRoom` adjusts larger existing room limits without
evicting current peers. Config and the 5,000-entry in-memory audit ring are persisted under the
git-ignored `data/` directory.

Admins can connect to `ws://localhost:3001/ws/admin?token=<JWT>` for a live feed of two-second
stats and room, peer, and audit events. The feed is admin-only and server-to-client. Mute messages
are best-effort P2P requests: a browser can ignore them because the signaling server does not
control the media track.

## Smoke tests

Run the P1 and P2 room/admin checks with:

```powershell
npm run test:admin-smoke
```

The smoke test starts a temporary local platform stub for room verification and message
persistence. It does not require the platform service, a platform `.env`, or manual setup.
The smoke test includes the 30-second owner transfer grace period, admin API/feed, audit,
runtime config, mute requests, announcements, and user deny/disconnect.

## Docker and TURN

The standalone Compose setup runs the realtime service and Coturn. The platform service must
already be reachable at `PLATFORM_URL`; for Docker Desktop on Windows, the example uses
`http://host.docker.internal:3000`.

Copy the placeholder environment file, set the shared values, and render the Coturn config before
starting the services:

```powershell
Copy-Item .env.example .env
# Edit .env; use the same JWT_SECRET, INTERNAL_API_KEY, TURN_HOST, TURN_SECRET, and TURN_TTL
# values as the platform where applicable.
node scripts/render-turn-config.js
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f realtime coturn
```

The renderer writes `coturn/turnserver.conf`, which is ignored by Git and mounted read-only at
`/etc/coturn/turnserver.conf` in Coturn. `TURN_SECRET` must match the platform's
`/api/config/ice` secret. Do not commit `.env` or the rendered configuration.

| Variable | Required | Example | Provided by / used by |
|---|---|---|---|
| `PORT` | No; defaults to `3001` | `3001` | Realtime deployment |
| `JWT_SECRET` | Yes | `<shared-platform-jwt-secret>` | Ann/platform; shared with the token issuer |
| `INTERNAL_API_KEY` | Yes; minimum 24 characters | `<shared-internal-key>` | Ann/platform; same value in platform and realtime |
| `PLATFORM_URL` | Yes for Compose | `http://host.docker.internal:3000` | Ann/deployment; platform URL reachable from the container |
| `NODE_ENV` | No; defaults to `production` in Compose | `production` | Deployment operator |
| `TURN_HOST` | Yes for platform-issued TURN ICE servers | `<public-turn-host>` | Ann/platform; advertised to clients by `/api/config/ice` |
| `TURN_SECRET` | Yes when enabling TURN | `<shared-platform-turn-secret>` | Ann/platform; Coturn renderer and credential helper |
| `TURN_TTL` | No; defaults to `3600` seconds | `3600` | Ann/platform; credential lifetime |
| `TURN_REALM` | Yes to render Coturn config | `<turn-realm>` | TURN deployment operator |
| `TURN_EXTERNAL_IP` | Production only | `<public-ip>` | TURN host provider; required for production config rendering |

`JWT_SECRET`, `INTERNAL_API_KEY`, and `TURN_SECRET` must be distinct. `TURN_HOST` and
`TURN_TTL` are platform settings; `TURN_SECRET`, `TURN_REALM`, and `TURN_EXTERNAL_IP` are read
by the local renderer. In development, `TURN_EXTERNAL_IP` may be empty; Coturn then returns its
container/private relay address, which is not reachable from the public internet.

| Service | Ports |
|---|---|
| Realtime HTTP and WebSocket | `3001/tcp` |
| Coturn listener | `3478/udp`, `3478/tcp` |
| Coturn relay range | `49160-49200/udp`, `49160-49200/tcp` |
| Realtime persistent data | Docker volume mounted at `/app/data` |

On Docker Desktop for Windows, keep the relay range small. A real internet STUN/TURN test needs a
public TURN server, `TURN_EXTERNAL_IP` set to its public IP, and the listener and relay ports
reachable through the host firewall/NAT. The local Compose allocation test does not verify that
public network path.

Generate a short-lived test credential with a user ID (or other unique name):

```powershell
node scripts/make-turn-credential.js <user-id>
```

The helper reads `TURN_SECRET` and optional `TURN_TTL` from `.env` and prints the time-limited
username, HMAC-SHA1 password, and expiry. Its format matches the platform's `expiry:user.id`
credential format when `<user-id>` is the platform user ID.

The platform currently also advertises `turns:<TURN_HOST>:5349?transport=tcp`. This Compose
configuration does not enable a TLS listener or mount certificates, and does not publish port
`5349`; that advertised TLS candidate is therefore not supported by this setup.

## Scope and priorities

Implemented P1 and P2: verified JWT roles, room ownership/settings/locks/limits, kick/ban, close
and owner transfer; chat/screen-share policy; mute requests; all listed admin API routes; runtime
config and rate limits; audit ring/file persistence; and the admin live feed. P1/P2 behaviors are
covered by `npm run test:admin-smoke`.

P3 waiting-room and room-password features are not implemented. Contract deviation: an owner may
rejoin a locked room to satisfy the acceptance test, while owners still cannot join a full room;
the permission matrix documents the distinction.

## Handoff for Ann

- Image build context: `./realtime`; exposed Realtime port: `3001/tcp`.
- Required Realtime variables: `JWT_SECRET`, `INTERNAL_API_KEY` (at least 24 characters), and
  `PLATFORM_URL`. `PORT` defaults to `3001`; set `NODE_ENV=production` in deployment.
- Persistent Realtime data is stored in `/app/data` (the standalone Compose named volume is
  `realtime-data`).
- Coturn reads `/etc/coturn/turnserver.conf`, rendered from `./coturn/turnserver.conf.template`.
  Publish `3478/udp`, `3478/tcp`, and relay range `49160-49200/udp,tcp`. Production rendering
  requires `TURN_EXTERNAL_IP`.
- `TURN_SECRET` must be exactly the same value configured in the platform for `/api/config/ice`.
  Keep it distinct from `JWT_SECRET` and `INTERNAL_API_KEY`.
- Nginx must proxy both `/ws` and `/ws/admin` using HTTP/1.1 WebSocket upgrade headers and pass
  `X-Forwarded-For` (for example, `$proxy_add_x_forwarded_for`).
- **Client-IP caveat:** the current server records `request.socket.remoteAddress` and ignores
  `X-Forwarded-For`; passing the header alone will still make `/admin/connections` show Nginx's
  address. Supporting trusted forwarded addresses requires a separate server change.
- The platform advertises a TLS TURN candidate on `5349`, but this Coturn setup has no TLS listener
  or certificates yet.
