// Fake Administrator backend (in memory) with the SAME exports and response shapes as ./real.js.
// - rooms / connections / stats / config / audit / feed behave like the real-time server (Member 2)
// - users reuse the localStorage accounts of api/mock.js, so a user created here can really log in (Member 3)
// A small timer makes the data "live" while an admin page has the feed open.
import { getAuth } from '../storage';
import { ApiError } from '../errors';
import { users as loadUsers, saveUsers } from '../mock';
import { validateCredentials } from '../endpoints';

const wait = (ms = 180) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const rid = () => Math.random().toString(36).slice(2, 8);
const fail = (status, code, message) => { throw new ApiError(message, { status, code }); };
const clone = (x) => JSON.parse(JSON.stringify(x));

const DEFAULT_SETTINGS = { maxPeers: 4, locked: false, chatEnabled: true, screenShare: 'everyone' };
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const peer = (userId, username, role = 'user', joinedAgo = 300, media = ['camera', 'microphone']) => ({
  peerId: `peer-${rid()}`, userId, username, role, joinedAt: ago(joinedAgo), ip: `10.0.${Math.floor(Math.random() * 9)}.${10 + Math.floor(Math.random() * 200)}`,
  mediaState: media.map((kind) => ({ kind, active: true, streamId: `${kind}-${rid()}` }))
});

function seed() {
  const alex = peer('user-alex', 'Alex'), sam = peer('user-sam', 'Sam', 'user', 200), mia = peer('user-mia', 'Mia', 'user', 90, ['camera', 'microphone', 'screen']);
  const lee = peer('user-lee', 'Lee', 'user', 600), noor = peer('user-noor', 'Noor', 'user', 500, ['microphone']);
  const adm = peer('mock-admin', 'admin', 'admin', 40, ['camera']);
  return {
    startedAt: Date.now() - 3 * 3600 * 1000,
    peak: 9,
    errors: { FORBIDDEN: 4, ROOM_FULL: 3, ROOM_LOCKED: 2, BANNED_FROM_ROOM: 1, INVALID_SETTING: 1, NOT_IN_ROOM: 2 },
    mps: 6,
    rooms: new Map([
      ['demo-room', { id: 'demo-room', ownerUserId: 'user-alex', settings: { ...DEFAULT_SETTINGS }, createdAt: ago(5400), peers: [alex, sam, mia] }],
      ['study-room', { id: 'study-room', ownerUserId: 'user-lee', settings: { ...DEFAULT_SETTINGS, locked: true, maxPeers: 3 }, createdAt: ago(2600), peers: [lee, noor] }],
      ['team-standup', { id: 'team-standup', ownerUserId: null, settings: { ...DEFAULT_SETTINGS, chatEnabled: false, screenShare: 'owner' }, createdAt: ago(900), peers: [adm] }]
    ]),
    extraSockets: [{ userId: 'user-zed', username: 'zed', role: 'user', ip: '10.0.3.77', since: ago(120), room: null }],
    config: { maxPeersPerRoom: 4, maxRooms: 100, maxConnectionsPerUser: 3, rateLimit: 30, defaultRoomSettings: { ...DEFAULT_SETTINGS } },
    audit: [
      { id: rid(), ts: ago(3000), actor: { userId: 'user-lee', username: 'Lee', role: 'user' }, action: 'settings-change', room: 'study-room', target: null, details: { settings: { locked: true } }, result: 'success' },
      { id: rid(), ts: ago(1500), actor: { userId: 'user-sam', username: 'Sam', role: 'user' }, action: 'forbidden', room: 'demo-room', target: null, details: { message: 'Only the room owner or an admin may perform this action.' }, result: 'denied' }
    ],
    denied: new Map(),
    sockets: new Map()
  };
}

let db = seed();
const listeners = new Set();
let ticker = null;

const me = () => {
  const a = getAuth();
  if (!a?.token) fail(401, 'INVALID_TOKEN', 'The Authorization header is missing or the JWT is invalid.');
  if (a.role !== 'admin') fail(403, 'FORBIDDEN', 'Admin role required.');
  return { userId: a.userId, username: a.username, role: a.role };
};
const emit = (ev) => listeners.forEach((l) => { try { l(ev); } catch { /* ignore */ } });
const bump = (code) => { db.errors[code] = (db.errors[code] || 0) + 1; };

function recordAudit(action, room = null, target = null, details = {}, result = 'success', actor = me()) {
  const entry = { id: rid() + rid(), ts: nowIso(), actor, action, room, target, details, result };
  db.audit.push(entry);
  if (db.audit.length > 5000) db.audit.shift();
  emit({ type: 'audit', entry });
  return entry;
}

const ownerOf = (r) => {
  const p = r.peers.find((x) => x.userId === r.ownerUserId);
  return { peerId: p?.peerId || null, userId: r.ownerUserId };
};
const summary = (r) => ({ id: r.id, owner: ownerOf(r), peerCount: r.peers.length, settings: { ...r.settings }, createdAt: r.createdAt });
const socketsNow = () => [...db.rooms.values()].reduce((n, r) => n + r.peers.length, 0) + db.extraSockets.length;
const snapshot = () => {
  const connections = socketsNow();
  db.peak = Math.max(db.peak, connections);
  return {
    connections, peakConnections: db.peak, rooms: db.rooms.size,
    peers: [...db.rooms.values()].reduce((n, r) => n + r.peers.length, 0),
    messagesPerSecond: db.mps, errorsByCode: { ...db.errors }, uptime: Math.floor((Date.now() - db.startedAt) / 1000)
  };
};
const roomOr404 = (id) => db.rooms.get(id) || fail(404, 'ROOM_CLOSED', 'Room does not exist.');
const touch = (r) => emit({ type: 'room-updated', room: summary(r) });

function validateSettings(r, input) {
  const bad = (m) => fail(400, 'INVALID_SETTING', m);
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('settings must be an object.');
  const next = { ...r.settings };
  for (const [k, v] of Object.entries(input)) {
    if (k === 'maxPeers') { if (!Number.isInteger(v) || v < 1 || v > db.config.maxPeersPerRoom) bad(`maxPeers must be an integer from 1 to ${db.config.maxPeersPerRoom}.`); }
    else if (k === 'locked' || k === 'chatEnabled') { if (typeof v !== 'boolean') bad(`${k} must be a boolean.`); }
    else if (k === 'screenShare') { if (v !== 'everyone' && v !== 'owner') bad('screenShare must be "everyone" or "owner".'); }
    else bad(`Unknown setting: ${k}.`);
    next[k] = v;
  }
  return next;
}

// ----- stats / rooms -----
export async function getStats() { await wait(); me(); return snapshot(); }
export async function listRooms() { await wait(); me(); return [...db.rooms.values()].map(summary); }
export async function getRoom(id) {
  await wait(); me();
  const r = roomOr404(id);
  return { ...summary(r), peers: r.peers.map(({ ip, ...p }) => clone(p)) };
}
export async function updateRoomSettings(id, settings) {
  await wait(); me();
  const r = roomOr404(id);
  r.settings = validateSettings(r, settings);
  recordAudit('settings-change', id, null, { settings: r.settings });
  touch(r);
  return { ok: true, settings: { ...r.settings } };
}
export async function kickFromRoom(id, { peerId, userId, ban }) {
  await wait(); me();
  const r = roomOr404(id);
  const targets = r.peers.filter((p) => p.peerId === peerId || (userId && p.userId === userId));
  if (!targets.length) fail(404, 'PEER_NOT_FOUND', 'Peer is not in the room.');
  targets.forEach((t) => {
    r.peers = r.peers.filter((p) => p !== t);
    recordAudit(ban ? 'ban' : 'kick', id, t.userId, { peerId: t.peerId, reason: 'Removed by an administrator.' });
    emit({ type: 'peer-left', room: id, peerId: t.peerId });
  });
  touch(r);
  return { ok: true, removed: targets.length };
}
export async function muteInRoom(id, { peerId, kind }) {
  await wait(); me();
  const r = roomOr404(id);
  const t = r.peers.find((p) => p.peerId === peerId) || fail(404, 'PEER_NOT_FOUND', 'Peer is not in the room.');
  if (!['audio', 'video', 'screen'].includes(kind)) fail(400, 'BAD_MESSAGE', 'peerId and a valid kind are required.');
  const media = { audio: 'microphone', video: 'camera', screen: 'screen' }[kind];
  t.mediaState = t.mediaState.filter((m) => m.kind !== media);
  recordAudit('mute-peer', id, t.userId, { peerId, kind });
  return { ok: true };
}
export async function transferOwner(id, peerId) {
  await wait(); me();
  const r = roomOr404(id);
  const t = r.peers.find((p) => p.peerId === peerId) || fail(404, 'PEER_NOT_FOUND', 'Peer is not in the room.');
  r.ownerUserId = t.userId;
  recordAudit('owner-transfer', id, t.userId, { peerId });
  touch(r);
  return { ok: true, owner: ownerOf(r) };
}
export async function closeRoom(id, reason) {
  await wait(); me();
  const r = roomOr404(id);
  db.rooms.delete(id);
  recordAudit('room-close', id, null, { reason: reason || 'Room closed by an administrator.' });
  emit({ type: 'room-closed', room: id, reason: reason || 'Room closed by an administrator.', by: getAuth()?.userId });
  return { ok: true, closed: r.id };
}

// ----- connections / deny -----
export async function listConnections() {
  await wait(); me();
  const out = [];
  for (const r of db.rooms.values()) r.peers.forEach((p) => out.push({ user: { userId: p.userId, username: p.username, role: p.role }, ip: p.ip, room: r.id, since: p.joinedAt, messagesPerSecond: Math.random() < 0.3 ? Math.floor(Math.random() * 4) : 0 }));
  db.extraSockets.forEach((s) => out.push({ user: { userId: s.userId, username: s.username, role: s.role }, ip: s.ip, room: s.room, since: s.since, messagesPerSecond: 0 }));
  return out;
}
function dropUser(userId) {
  let n = 0;
  for (const r of db.rooms.values()) {
    const gone = r.peers.filter((p) => p.userId === userId);
    if (gone.length) { r.peers = r.peers.filter((p) => p.userId !== userId); gone.forEach((g) => emit({ type: 'peer-left', room: r.id, peerId: g.peerId })); n += gone.length; touch(r); }
  }
  const before = db.extraSockets.length;
  db.extraSockets = db.extraSockets.filter((s) => s.userId !== userId);
  return n + (before - db.extraSockets.length);
}
export async function disconnectUser(userId) {
  await wait(); me();
  const n = dropUser(userId);
  recordAudit('user-disconnect', null, userId, { sockets: n });
  return { ok: true, disconnected: n };
}
export async function denyUser(userId, minutes) {
  await wait(); me();
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525600) fail(400, 'BAD_MESSAGE', 'minutes must be an integer from 1 to 525600.');
  const expiresAt = Date.now() + minutes * 60000;
  db.denied.set(userId, expiresAt);
  dropUser(userId);
  recordAudit('user-deny', null, userId, { minutes, expiresAt: new Date(expiresAt).toISOString() });
  return { ok: true, expiresAt: new Date(expiresAt).toISOString() };
}
export async function allowUser(userId) {
  await wait(); me();
  const existed = db.denied.delete(userId);
  recordAudit('user-deny-lift', null, userId, { existed });
  return { ok: true, existed };
}

// ----- announce / config / audit -----
export async function announce({ text, room }) {
  await wait(); me();
  if (!text || !String(text).trim() || text.length > 4000) fail(400, 'BAD_MESSAGE', 'text is required (max 4000 chars); room must be a non-empty string.');
  if (room) roomOr404(room);
  recordAudit('announcement', room || null, null, { text });
  return { ok: true };
}
export async function getConfig() { await wait(); me(); return clone(db.config); }
export async function updateConfig(patch) {
  await wait(); me();
  const bad = (m) => fail(400, 'INVALID_SETTING', m);
  const next = clone(db.config);
  const ranges = { maxPeersPerRoom: [1, 100], maxRooms: [1, 10000], maxConnectionsPerUser: [1, 100], rateLimit: [1, 10000] };
  for (const k of Object.keys(patch)) if (!(k in ranges) && k !== 'defaultRoomSettings') bad(`Unknown config field: ${k}.`);
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    if (k in patch) { if (!Number.isInteger(patch[k]) || patch[k] < lo || patch[k] > hi) bad(`${k} must be an integer from ${lo} to ${hi}.`); next[k] = patch[k]; }
  }
  if (patch.defaultRoomSettings) next.defaultRoomSettings = validateSettings({ settings: next.defaultRoomSettings }, patch.defaultRoomSettings);
  if (next.defaultRoomSettings.maxPeers > next.maxPeersPerRoom) {
    if (patch.defaultRoomSettings) bad('defaultRoomSettings.maxPeers cannot exceed maxPeersPerRoom.');
    next.defaultRoomSettings.maxPeers = next.maxPeersPerRoom;
  }
  db.config = next;
  for (const r of db.rooms.values()) if (r.settings.maxPeers > next.maxPeersPerRoom) { r.settings.maxPeers = next.maxPeersPerRoom; touch(r); }
  recordAudit('config-change', null, null, { config: patch });
  return clone(db.config);
}
export async function getAudit({ limit = 100, action, room, user } = {}) {
  await wait(); me();
  const rows = db.audit.filter((e) => (!action || e.action === action) && (!room || e.room === room) && (!user || e.actor.userId === user || e.target === user || e.actor.username === user));
  return rows.slice(-limit).reverse();
}

// ----- users (platform mock; shares localStorage accounts with the login mock) -----
const pub = ({ password: _pw, ...u }) => ({ disabled: false, ...u });
export async function listUsers({ search, role } = {}) {
  await wait(); me();
  const q = (search || '').toLowerCase();
  return loadUsers().filter((u) => (!q || u.username.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)) && (!role || u.role === role)).map(pub);
}
export async function createUser({ username, password, role = 'user' }) {
  await wait(); me();
  const bad = validateCredentials(username, password);
  if (bad) fail(400, 'VALIDATION_ERROR', bad);
  if (role !== 'user' && role !== 'admin') fail(400, 'VALIDATION_ERROR', 'role must be "user" or "admin".');
  const list = loadUsers();
  if (list.some((u) => u.username.toLowerCase() === username.toLowerCase())) fail(409, 'USERNAME_TAKEN', 'The username already exists.');
  const user = { id: `user-${rid()}`, username, password, role, disabled: false, createdAt: nowIso() };
  saveUsers([...list, user]);
  return pub(user);
}
export async function updateUser(id, patch) {
  await wait(); me();
  const list = loadUsers();
  const u = list.find((x) => x.id === id) || fail(404, 'NOT_FOUND', 'User not found.');
  if (patch.role !== undefined) { if (patch.role !== 'user' && patch.role !== 'admin') fail(400, 'VALIDATION_ERROR', 'role must be "user" or "admin".'); u.role = patch.role; }
  if (patch.disabled !== undefined) u.disabled = !!patch.disabled;
  saveUsers(list);
  return pub(u);
}
export async function resetPassword(id, password) {
  await wait(); me();
  const bad = validateCredentials('placeholder', password);
  if (bad) fail(400, 'VALIDATION_ERROR', bad);
  const list = loadUsers();
  const u = list.find((x) => x.id === id) || fail(404, 'NOT_FOUND', 'User not found.');
  u.password = password;
  saveUsers(list);
  return { ok: true };
}
export async function deleteUser(id) {
  await wait(); me();
  const list = loadUsers();
  if (!list.some((x) => x.id === id)) fail(404, 'NOT_FOUND', 'User not found.');
  if (id === getAuth()?.userId) fail(403, 'FORBIDDEN', 'You cannot delete your own account.');
  saveUsers(list.filter((x) => x.id !== id));
}

// ----- live feed (simulated) -----
function tick() {
  db.mps = Math.max(0, Math.min(40, db.mps + Math.round((Math.random() - 0.45) * 5)));
  const rooms = [...db.rooms.values()];
  const roll = Math.random();
  if (roll < 0.18 && rooms.length) { // someone joins
    const r = rooms[Math.floor(Math.random() * rooms.length)];
    if (r.peers.length < r.settings.maxPeers) {
      const names = ['Kai', 'Jin', 'Ana', 'Tom', 'Eve', 'Raj'];
      const n = names[Math.floor(Math.random() * names.length)];
      const p = peer(`user-${n.toLowerCase()}`, n, 'user', 0);
      r.peers.push(p);
      if (!r.ownerUserId) r.ownerUserId = p.userId;
      emit({ type: 'peer-joined', room: r.id, peer: { peerId: p.peerId, userId: p.userId, username: p.username, role: p.role } });
      touch(r);
    }
  } else if (roll < 0.3 && rooms.length) { // someone leaves
    const r = rooms[Math.floor(Math.random() * rooms.length)];
    if (r.peers.length > 1) { const p = r.peers.pop(); emit({ type: 'peer-left', room: r.id, peerId: p.peerId }); touch(r); }
  } else if (roll < 0.34) { // an error happens
    bump(['ROOM_FULL', 'FORBIDDEN', 'RATE_LIMITED'][Math.floor(Math.random() * 3)]);
  }
  emit({ type: 'stats', ...snapshot() });
}

export function openFeed(onEvent, onStatus) {
  me();
  onStatus('connecting');
  const t0 = setTimeout(() => { onStatus('live'); onEvent({ type: 'stats', ...snapshot() }); }, 300);
  listeners.add(onEvent);
  if (!ticker) ticker = setInterval(tick, 2000);
  return () => {
    clearTimeout(t0);
    listeners.delete(onEvent);
    if (!listeners.size) { clearInterval(ticker); ticker = null; }
  };
}
