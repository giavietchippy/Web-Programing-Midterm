# WebSocket Contract v1.0

This document defines the v1.0 signaling protocol for the WebRTC meeting app.

## Connection and message format

Connect to `ws://host/ws?token=<JWT>`. In a deployed HTTPS environment, use the equivalent
`wss://` URL. The JWT contract is documented in [token-contract.md](./token-contract.md).

All application messages are JSON text frames using the envelope
`{ "type": string, ...fields }`. Each connection receives a server-generated `peerId`, unique
among the peers currently connected to the service. A `room` is a non-empty string. A connection
may be in one room at a time. `sdp` is an SDP string, and `candidate` is an ICE candidate object
as supplied by the browser's WebRTC API.

| Type            | Sender                                               | Fields                                                     | Meaning                                                                                                                           |
| --------------- | ---------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `join`          | Client                                               | `room`                                                     | Join the named room.                                                                                                              |
| `joined`        | Server, to the joiner only                           | `peerId`, `room`, `peers: [{peerId, username}]`            | Confirms the join and lists peers already in the room. `peers` does not include the joiner.                                       |
| `peer-joined`   | Server, to the other peers in the room               | `peerId`, `username`                                       | Announces a newly joined peer.                                                                                                    |
| `leave`         | Client                                               | `room`                                                     | Leave the named room.                                                                                                             |
| `peer-left`     | Server, to the other peers in the room               | `peerId`                                                   | Announces that a peer has left or disconnected.                                                                                   |
| `offer`         | Client; server forwards to `to`                      | `to`, `sdp`, `from` (added by server)                      | Relays an SDP offer to the addressed peer in the same room.                                                                       |
| `answer`        | Client; server forwards to `to`                      | `to`, `sdp`, `from` (added by server)                      | Relays an SDP answer to the addressed peer in the same room.                                                                      |
| `ice-candidate` | Client; server forwards to `to`                      | `to`, `candidate`, `from` (added by server)                | Relays an ICE candidate to the addressed peer in the same room.                                                                   |
| `chat`          | Client; server broadcasts to the room                | `text`; server fields: `from`, `username`, `ts`            | Broadcasts a text message to every peer in the room, including its sender. `ts` is the server's UTC timestamp in ISO 8601 format. |
| `media-state`   | Client; server broadcasts to other peers in the room | `kind`, `active`, `streamId`; server field: `from` (added) | Announces whether the peer's camera or screen stream is active. The server broadcasts the fields without inspecting them.         |
| `error`         | Server                                               | `code`, `message`                                          | Reports a rejected message or connection error. The connection is closed only for the errors marked as closing below.             |

### JSON examples

Client joins a room:

```json
{ "type": "join", "room": "study-room" }
```

Server confirms to the joiner; `peers` may be empty:

```json
{
  "type": "joined",
  "peerId": "peer-a",
  "room": "study-room",
  "peers": [{ "peerId": "peer-b", "username": "Sam" }]
}
```

Server tells existing room members about the join:

```json
{ "type": "peer-joined", "peerId": "peer-a", "username": "Alex" }
```

Client leaves:

```json
{ "type": "leave", "room": "study-room" }
```

Server announces that a peer left:

```json
{ "type": "peer-left", "peerId": "peer-a" }
```

Client sends an offer to a peer:

```json
{ "type": "offer", "to": "peer-b", "sdp": "v=0\r\n..." }
```

Server forwards it with the sender's peer ID:

```json
{ "type": "offer", "from": "peer-a", "to": "peer-b", "sdp": "v=0\r\n..." }
```

Client sends an answer:

```json
{ "type": "answer", "to": "peer-a", "sdp": "v=0\r\n..." }
```

Server forwards the answer with the sender's peer ID:

```json
{ "type": "answer", "from": "peer-b", "to": "peer-a", "sdp": "v=0\r\n..." }
```

Client sends an ICE candidate:

```json
{
  "type": "ice-candidate",
  "to": "peer-b",
  "candidate": {
    "candidate": "candidate:1 1 UDP 2122260223 192.0.2.1 50000 typ host",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

Server forwards the candidate with the sender's peer ID:

```json
{
  "type": "ice-candidate",
  "from": "peer-a",
  "to": "peer-b",
  "candidate": {
    "candidate": "candidate:1 1 UDP 2122260223 192.0.2.1 50000 typ host",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

Client sends chat; server broadcasts the normalized message, including to the sender:

```json
{ "type": "chat", "text": "Hello!" }
```

```json
{
  "type": "chat",
  "from": "peer-a",
  "username": "Alex",
  "text": "Hello!",
  "ts": "2026-11-10T03:30:00.000Z"
}
```

Example server error:

```json
{ "type": "error", "code": "NOT_IN_ROOM", "message": "Join a room before sending this message." }
```

Client announces screen sharing:

```json
{ "type": "media-state", "kind": "screen", "active": true, "streamId": "screen-stream-1" }
```

Server broadcasts the state to the other peers in the room:

```json
{
  "type": "media-state",
  "from": "peer-a",
  "kind": "screen",
  "active": true,
  "streamId": "screen-stream-1"
}
```

Client announces that it stopped sharing:

```json
{ "type": "media-state", "kind": "screen", "active": false, "streamId": "screen-stream-1" }
```

## Track changes and renegotiation

After the initial connection, a peer that adds or removes a track (for example, starting or
stopping screen sharing) creates a new `offer` on the same `RTCPeerConnection`. The remote peer
sets it as the remote description, creates an `answer`, and sends that answer over the same
connection. Camera and screen tracks use separate `MediaStream` instances.

Use the perfect negotiation pattern to resolve simultaneous offers. The peer whose `peerId` is
lexicographically smaller is polite; the other peer is impolite. If an offer arrives while the
polite peer is making an offer or is not in the stable signaling state, it rolls back its local
offer and accepts the incoming offer. The impolite peer ignores an offer collision. Both peers
continue using the same peer connection and ICE candidate relay.

| Situation          | Polite peer (smaller `peerId`)                                     | Impolite peer (larger `peerId`)                       |
| ------------------ | ------------------------------------------------------------------ | ----------------------------------------------------- |
| No offer collision | Accepts the offer and answers normally.                            | Accepts the offer and answers normally.               |
| Offer collision    | Rolls back its local offer, accepts the remote offer, and answers. | Ignores the incoming offer and keeps its local offer. |

`peer-left` means that peer has no active media state, including camera and screen sharing. A
receiver must clear all remote media state for that peer when it receives `peer-left`.

### Screen-sharing renegotiation sequence

```mermaid
sequenceDiagram
    participant A as Peer A
    participant S as Signaling server
    participant B as Peer B
    A->>A: Add screen track in separate MediaStream
    A->>S: media-state(kind=screen, active=true, streamId)
    S-->>B: media-state(from=A, kind=screen, active=true, streamId)
    A->>A: Create new offer on existing RTCPeerConnection
    A->>S: offer(to=B, sdp)
    S-->>B: offer(from=A, to=B, sdp)
    B->>B: Set remote offer and create answer
    B->>S: answer(to=A, sdp)
    S-->>A: answer(from=B, to=A, sdp)
    Note over A,B: ICE updates; camera and screen tracks flow
```

## Relay and call-flow rules

- The signaling server never inspects or modifies `sdp` or `candidate`; it only relays those
  values to the addressed peer in the same room.
- During initial room joining, the new joiner receives `joined` with the list of existing peers
  and then creates an offer to each existing peer. Existing peers only answer those initial
  offers; they do not initiate an offer to the new joiner. Track changes after connection may
  trigger renegotiation by either peer as described above.
- `peer-joined` is sent to existing peers after the new peer has been added to the room.
- `media-state` messages are forwarded to all other peers in the sender's room with the sender's
  `peerId` in `from`; the server does not inspect the media-state fields.
- On `peer-joined`, existing clients should announce their currently active camera and screen
  states again. This lets a new joiner classify media streams, including a screen share already
  in progress, without the server storing media state.
- On a normal `leave` or connection close, the server removes the peer from its room and sends
  `peer-left` to the remaining room members; this implies the peer's media-state is inactive.

## Errors and close codes

When an error closes a connection, the server sends the `error` message first, then closes the
WebSocket with the listed application close code. An error marked “No” leaves the connection open
so the client can correct the request and continue. Close code `1000` is used for a normal client
disconnect, not for an error.

| Code                   | When it happens                                                                                                                     | Closes connection? | WebSocket close code |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------- |
| `INVALID_TOKEN`        | The token is missing, malformed, has an invalid signature, or has invalid required claims.                                          | Yes                | `4001`               |
| `TOKEN_EXPIRED`        | The token's expiration time has passed.                                                                                             | Yes                | `4002`               |
| `RATE_LIMITED`         | The connection exceeds 30 client messages in one second.                                                                            | Yes                | `4003`               |
| `ROOM_FULL`            | A join would exceed the room peer limit.                                                                                            | No                 | N/A                  |
| `NOT_IN_ROOM`          | A room-scoped message is sent before joining, or `leave.room` does not match the connection's current room.                         | No                 | N/A                  |
| `PEER_NOT_FOUND`       | A relay target is not a connected peer in the sender's current room.                                                                | No                 | N/A                  |
| `BAD_MESSAGE`          | A frame is not valid JSON, has an unknown type, misses required fields, has invalid field types, or exceeds the message-size limit. | Yes                | `4004`               |
| `TOO_MANY_CONNECTIONS` | The user exceeds the per-user connection limit.                                                                                     | Yes                | `4005`               |

If authentication fails before the WebSocket is accepted, the server rejects the upgrade with an
HTTP error instead; it cannot send a WebSocket `error` frame or close code in that case. Once the
WebSocket is accepted, the server sends the `error` frame before closing as described above.

## Limits

| Limit                                             | v1.0 value                    |
| ------------------------------------------------- | ----------------------------- |
| Maximum peers per room (including the local peer) | 4                             |
| Maximum connections per user                      | 3                             |
| Rate limit per connection                         | 30 client messages per second |
| Maximum message size                              | 64 KB (65,536 bytes)          |

## Call sequence

```mermaid
sequenceDiagram
    participant A as Peer A
    participant S as Signaling server
    participant B as Peer B
    A->>S: join(room)
    S-->>A: joined(peerId, room, peers=[])
    B->>S: join(room)
    S-->>B: joined(peerId, room, peers=[A])
    S-->>A: peer-joined(B)
    B->>S: offer(to=A, sdp)
    S-->>A: offer(from=B, to=A, sdp)
    A->>S: answer(to=B, sdp)
    S-->>B: answer(from=A, to=B, sdp)
    A->>S: ice-candidate(to=B, candidate)
    S-->>B: ice-candidate(from=A, to=B, candidate)
    B->>S: ice-candidate(to=A, candidate)
    S-->>A: ice-candidate(from=B, to=A, candidate)
    Note over A,B: ICE / DTLS connected; media flows peer-to-peer
```

## Change policy

Any change to this contract requires approval from all three team members and a version bump.
Implementations must not silently change the meaning or fields of v1.0 messages.
