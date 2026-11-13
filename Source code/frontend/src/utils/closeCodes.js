// Single source of truth for the WebSocket close codes defined in websocket-contract.md.
// Used by the room session (webrtc/RoomSession.js), the room page and the admin live feed,
// so every code shows ONE distinct message and none of them can start an automatic reconnect loop.
//
// action: what the UI offers next
//   'login'  - the token is bad/expired, only a new login helps
//   'retry'  - the user may press a button to reconnect by hand (never automatic)
//   'lobby'  - retrying is pointless (account denied); send the user back
export const CLOSE_INFO = {
  4000: { title: 'Disconnected by admin', name: 'ADMIN_DISCONNECT', action: 'retry', message: 'An administrator disconnected you.' },
  4001: { title: 'Invalid session', name: 'INVALID_TOKEN', action: 'login', message: 'Invalid token (INVALID_TOKEN). Check that JWT_SECRET is the same on platform and real-time services, then log in again.' },
  4002: { title: 'Session expired', name: 'TOKEN_EXPIRED', action: 'login', message: 'Your session expired (TOKEN_EXPIRED). Please log in again.' },
  4003: { title: 'Too many messages', name: 'RATE_LIMITED', action: 'retry', message: 'You sent too many messages (RATE_LIMITED, limit 30 per second). Wait a few seconds, then reconnect.' },
  4004: { title: 'Message rejected', name: 'BAD_MESSAGE', action: 'retry', message: 'The server rejected a message (BAD_MESSAGE).' },
  4005: { title: 'Too many connections', name: 'TOO_MANY_CONNECTIONS', action: 'retry', message: 'Too many connections for this account (TOO_MANY_CONNECTIONS, max 3). Close another tab, then reconnect.' },
  4006: { title: 'Account denied', name: 'USER_DENIED', action: 'lobby', message: 'Your account has been denied by an administrator (USER_DENIED). Try again later or contact an admin.' }
};

export const closeInfo = (code) => CLOSE_INFO[code] || null;

// Application close codes (4000-4006) are deliberate server decisions: reconnecting automatically
// would just be refused again and again. Only unexpected drops (1006 etc.) may be retried with backoff.
export const isFinalClose = (code) => code in CLOSE_INFO;
