# Real-time signaling server

## Requirements

- Node.js LTS and npm
- A local `JWT_SECRET` shared with any platform service that issues tokens

## Start the server

From this directory, install dependencies and create a local environment file:

```powershell
npm install
Copy-Item .env.example .env
```

Set `JWT_SECRET` in `.env` to a private random value. Use the same value in the platform service.
Never commit `.env` or generated tokens. Start the server with:

```powershell
npm start
```

By default, the WebSocket endpoint is `ws://localhost:8080/ws` and the reference client is
`http://localhost:8080/realtime/reference-client/`.

## Open the test client and get a development token

Open `http://localhost:8080/realtime/reference-client` in two browser tabs. In each tab, enter a
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
Invoke-RestMethod http://localhost:8080/admin/stats -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://localhost:8080/admin/rooms -Headers @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://localhost:8080/admin/rooms/demo-room/close -Method Post `
  -ContentType 'application/json' -Headers @{ Authorization = "Bearer $token" } `
  -Body '{"reason":"Meeting ended"}'
Invoke-RestMethod http://localhost:8080/admin/rooms/demo-room/settings -Method Patch `
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

Admins can connect to `ws://localhost:8080/ws/admin?token=<JWT>` for a live feed of two-second
stats and room, peer, and audit events. The feed is admin-only and server-to-client. Mute messages
are best-effort P2P requests: a browser can ignore them because the signaling server does not
control the media track.

## Smoke tests

Run the P1 and P2 room/admin checks with:

```powershell
npm run test:admin-smoke
```

The smoke test includes the 30-second owner transfer grace period, admin API/feed, audit,
runtime config, mute requests, announcements, and user deny/disconnect.

## Scope and priorities

Implemented P1 and P2: verified JWT roles, room ownership/settings/locks/limits, kick/ban, close
and owner transfer; chat/screen-share policy; mute requests; all listed admin API routes; runtime
config and rate limits; audit ring/file persistence; and the admin live feed. P1/P2 behaviors are
covered by `npm run test:admin-smoke`.

P3 waiting-room and room-password features are not implemented. Contract deviation: an owner may
rejoin a locked room to satisfy the acceptance test, while owners still cannot join a full room;
the permission matrix documents the distinction.
