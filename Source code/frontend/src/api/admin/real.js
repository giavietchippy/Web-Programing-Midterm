// Real Administrator API. Every call the admin pages make lives in this folder (real.js / mock.js),
// so swapping fake -> real data only means switching USE_MOCK_ADMIN.
//
//  Member 2 (real-time server, websocket-contract.md "Admin HTTP API"), reached through /realtime/admin/*:
//    GET  /admin/stats  /admin/rooms  /admin/rooms/:id  /admin/connections  /admin/config  /admin/audit
//    PATCH /admin/rooms/:id/settings   POST /admin/rooms/:id/{kick,mute,transfer-owner,close}
//    POST /admin/users/:userId/{disconnect,deny}   DELETE /admin/users/:userId/deny
//    POST /admin/announce   PUT /admin/config      WS /ws/admin (live feed)
//  Member 3 (platform REST), /api/admin/users  -- NOT in rest-api-contract v1.0 yet. ASSUMED shape (to confirm):
//    GET    /admin/users?search=&role=         -> { users:[{id,username,role,disabled,createdAt}] }
//    POST   /admin/users {username,password,role}   -> 201 { user }
//    PATCH  /admin/users/:id {role?,disabled?}      -> 200 { user }
//    POST   /admin/users/:id/password {password}    -> 200/204
//    DELETE /admin/users/:id                        -> 204
import { config, buildAdminWsUrl } from '../../config';
import { getAuth } from '../storage';
import { adminRequest } from './http';
import { isFinalClose } from '../../utils/closeCodes';

const rt = (path, opts) => adminRequest(config.RT_ADMIN_BASE, path, opts);
const platform = (path, opts) => adminRequest(config.API_BASE, `/admin/users${path}`, opts);
const enc = encodeURIComponent;

export const getStats = () => rt('/stats');
export const listRooms = () => rt('/rooms');
export const getRoom = (id) => rt(`/rooms/${enc(id)}`);
export const updateRoomSettings = (id, settings) => rt(`/rooms/${enc(id)}/settings`, { method: 'PATCH', body: settings });
export const kickFromRoom = (id, { peerId, userId, ban }) => rt(`/rooms/${enc(id)}/kick`, { method: 'POST', body: { peerId, userId, ban: !!ban } });
export const muteInRoom = (id, { peerId, kind }) => rt(`/rooms/${enc(id)}/mute`, { method: 'POST', body: { peerId, kind } });
export const transferOwner = (id, peerId) => rt(`/rooms/${enc(id)}/transfer-owner`, { method: 'POST', body: { peerId } });
export const closeRoom = (id, reason) => rt(`/rooms/${enc(id)}/close`, { method: 'POST', body: reason ? { reason } : {} });

export const listConnections = () => rt('/connections');
export const disconnectUser = (userId) => rt(`/users/${enc(userId)}/disconnect`, { method: 'POST', body: {} });
export const denyUser = (userId, minutes) => rt(`/users/${enc(userId)}/deny`, { method: 'POST', body: { minutes } });
export const allowUser = (userId) => rt(`/users/${enc(userId)}/deny`, { method: 'DELETE' });

export const announce = ({ text, room }) => rt('/announce', { method: 'POST', body: room ? { text, room } : { text } });
export const getConfig = () => rt('/config');
export const updateConfig = (patch) => rt('/config', { method: 'PUT', body: patch });
export const getAudit = ({ limit = 100, action, room, user } = {}) => rt('/audit', { query: { limit, action, room, user } });

// ----- users (Member 3) -----
export const listUsers = async ({ search, role } = {}) => (await platform('', { query: { search, role } })).users || [];
export const createUser = async ({ username, password, role }) => (await platform('', { method: 'POST', body: { username, password, role } })).user;
export const updateUser = (id, patch) => platform(`/${enc(id)}`, { method: 'PATCH', body: patch });
export const resetPassword = (id, password) => platform(`/${enc(id)}/password`, { method: 'POST', body: { password } });
export const deleteUser = (id) => platform(`/${enc(id)}`, { method: 'DELETE' });

// ----- live feed: ws://host/ws/admin?token=<JWT> -----
// Events: stats (every 2 s), room-created, room-updated, room-closed, peer-joined, peer-left, audit.
// onStatus('connecting' | 'live' | 'down', detail). detail = { code } on 'down' (the WebSocket close code).
// Reconnects with backoff until the returned function is called, EXCEPT after a final close code
// (4000-4006: bad/expired token, rate limit, denied...) - the server refused us on purpose, so retrying would loop.
export function openFeed(onEvent, onStatus) {
  let ws = null;
  let stopped = false;
  let attempt = 0;
  let timer = null;
  const connect = () => {
    const token = getAuth()?.token;
    if (!token || stopped) return;
    onStatus('connecting');
    try { ws = new WebSocket(buildAdminWsUrl(token)); } catch { onStatus('down'); return; }
    ws.onopen = () => { attempt = 0; onStatus('live'); };
    ws.onmessage = (ev) => { try { onEvent(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ } };
    ws.onclose = (ev) => {
      onStatus('down', { code: ev.code });
      if (stopped || isFinalClose(ev.code)) return; // 4001/4002/4003/4006...: do not hammer the server
      timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
    };
    ws.onerror = () => { /* onclose follows */ };
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (ws) { ws.onclose = null; try { ws.close(1000); } catch { /* noop */ } }
  };
}
