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

By default, the WebSocket endpoint is `ws://localhost:8080/ws`.

## Open the test client and get a development token

Open `http://localhost:8080/realtime/reference-client` in two browser tabs. In each tab, enter a
different username and select **Get token**. The development-only `POST /dev/token` endpoint
returns an HS256 JWT with a random `userId` and one-hour expiration. It is a stand-in for Member
3's `POST /api/login` and is disabled when `NODE_ENV=production`.

```powershell
# Optional: generate a token in the terminal instead
npm run make:test-token -- Alex
```

Enter the same room name in both tabs, select **Join**, and allow camera/microphone access.
Select **Share screen** to test a separate screen stream; stopping it from the browser's sharing
bar also stops the remote stream. Chat is broadcast to everyone in the room.

The client uses Google's public STUN server. Direct peer-to-peer connectivity may not work on
some networks without a TURN server.

## Current scope

The server validates JWTs, supports in-memory rooms, relays WebRTC signaling, and broadcasts
chat and media state. The rate limiter and stats endpoint are not implemented yet; the per-user
connection cap and room peer cap follow the v1.0 WebSocket contract. Development CORS is
restricted to `http://localhost` origins and is disabled in production.
