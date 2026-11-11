// ============================================================================
// REST API Contract v1.0 (rest-api-contract.md, platform backend / Member 3).
// All paths are relative to API_BASE (default "/api"). Authenticated calls send
//   Authorization: Bearer <JWT>
// Response shapes (frontend reads them in api/real.js; api/mock.js returns the same shapes):
//
//  POST   /register          {username,password}   -> 201 {user:{id,username,role,createdAt}}   (no token)
//  POST   /login             {username,password}   -> 200 {token,tokenType,expiresIn,user:{id,username,role}}
//  GET    /me                                      -> 200 {user:{id,username,role}}
//  GET    /rooms                                   -> 200 {rooms:[room]}  (createdAt desc)
//  POST   /rooms             {name}                -> 201 {room}   409 ROOM_NAME_TAKEN / ROOM_LIMIT_REACHED
//  GET    /rooms/:roomId                           -> 200 {room}   404 ROOM_NOT_FOUND
//  POST   /rooms/:roomId/join                      -> 200 {room}   (call BEFORE the WebSocket "join")
//  DELETE /rooms/:roomId                           -> 204          (creator or admin) 403 FORBIDDEN
//  GET    /rooms/:roomId/messages?limit&before     -> 200 {messages:[...oldest->newest], hasMore, nextBefore}
//  GET    /config/ice                              -> 200 {iceServers, ttl, expiresAt}  (call before EACH call)
//  GET    /admin/stats                             -> 200 {users,rooms,messages,realtime|null,generatedAt}  (admin)
//
//  room = {id,name,maxPeers,createdBy:{id,username},createdAt}
//  The room.id is what the client sends as `room` in the WebSocket join message.
//  Errors: {error:"CODE", message:"..."}; 401 INVALID_TOKEN / TOKEN_EXPIRED -> log in again.
//  (/internal/* endpoints are service-to-service only; the frontend never calls them.)
// ============================================================================
export const E = {
  login: '/login',
  register: '/register',
  me: '/me',
  rooms: '/rooms',
  room: (id) => `/rooms/${encodeURIComponent(id)}`,
  join: (id) => `/rooms/${encodeURIComponent(id)}/join`,
  history: (id) => `/rooms/${encodeURIComponent(id)}/messages`,
  ice: '/config/ice',
  adminStats: '/admin/stats'
};

// Validation rules (contract "Validation rules"), shared by AuthPage / Lobby and the mock.
export const RULES = {
  username: /^[A-Za-z0-9_.-]{3,32}$/,
  usernameHint: 'Username must be 3 to 32 characters: letters, digits, _ . -',
  passwordMinBytes: 8,
  passwordMaxBytes: 72,
  roomNameMax: 64
};
export const byteLength = (s) => new TextEncoder().encode(String(s)).length;
export function validateCredentials(username, password) {
  if (!RULES.username.test(username)) return RULES.usernameHint;
  const n = byteLength(password);
  if (n < RULES.passwordMinBytes || n > RULES.passwordMaxBytes) return `Password must be ${RULES.passwordMinBytes} to ${RULES.passwordMaxBytes} bytes.`;
  return '';
}
