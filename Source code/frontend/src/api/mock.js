// Fake REST backend (localStorage) that mimics REST contract v1.0, so the whole UI works without Member 3's server.
// Same exports and response shapes as api/real.js. Login still tries Member 2's dev-only POST /dev/token to get a
// REAL signed JWT, so the WebSocket handshake can succeed against the real signaling server.
import { config, DEFAULT_ICE_SERVERS } from '../config';
import { parseJwt } from '../utils/jwt';
import { RULES, validateCredentials } from './endpoints';
import { getAuth } from './storage';
import { ApiError, notifyAuthError } from './errors';

const MAX_ROOMS = 100;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const fail = (status, code, message, details) => { throw new ApiError(message, { status, code, details }); };

const SEED_USERS = [
  { id: 'mock-demo', username: 'demo', password: 'demo123', role: 'user', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'mock-admin', username: 'admin', password: 'admin123', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' }
];
const SEED_ROOMS = [
  { id: 'demo-room', name: 'Demo Room', maxPeers: 4, createdBy: { id: 'mock-admin', username: 'admin' }, createdAt: '2026-01-01T00:00:00.000Z' }
];

// Old mock data (before contract v1.0) had no id/role/createdBy: upgrade it in place.
function users() {
  const list = read('mock_users', null);
  if (!list) return SEED_USERS;
  return list.map((u) => ({ id: u.id || `mock-${u.username}`, role: u.role || (u.username === 'admin' ? 'admin' : 'user'), createdAt: u.createdAt || '2026-01-01T00:00:00.000Z', ...u }));
}
function rooms() {
  const list = read('mock_rooms', null);
  if (!list) return SEED_ROOMS;
  return list.map((r) => ({ maxPeers: 4, createdBy: { id: 'mock-admin', username: 'admin' }, createdAt: '2026-01-01T00:00:00.000Z', ...r }));
}
const history = () => read('mock_messages', {});

// The mock "server" reads the caller from the stored session, like the real one reads the JWT.
function currentUser() {
  const a = getAuth();
  if (!a?.token) { const e = new ApiError('The Authorization header is missing or the JWT is invalid.', { status: 401, code: 'INVALID_TOKEN' }); notifyAuthError(e); throw e; }
  const u = users().find((x) => x.username === a.username);
  return u || { id: a.userId || `mock-${a.username}`, username: a.username, role: a.role || 'user' };
}
const stripUser = (u) => ({ id: u.id, username: u.username, role: u.role });

async function devToken(username) {
  try {
    const r = await fetch(config.DEV_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (r.ok) { const d = await r.json(); if (d.token) return d.token; }
  } catch { /* real-time server not running */ }
  return 'mock.unsigned.token'; // WebSocket will be rejected - the Room page explains why
}

export async function login(username, password) {
  await wait();
  const u = users().find((x) => x.username.toLowerCase() === String(username).toLowerCase() && x.password === password);
  if (!u) fail(401, 'INVALID_CREDENTIALS', 'Wrong username or password. (mock accounts: demo / demo123, admin / admin123)');
  const token = await devToken(u.username);
  const p = parseJwt(token);
  return { token, userId: p?.userId || u.id, username: p?.username || u.username, role: u.role };
}

export async function register(username, password) {
  await wait();
  const bad = validateCredentials(username, password);
  if (bad) fail(400, 'VALIDATION_ERROR', bad);
  const list = users();
  if (list.some((x) => x.username.toLowerCase() === username.toLowerCase())) fail(409, 'USERNAME_TAKEN', 'The username already exists.');
  const user = { id: `user-${Math.random().toString(36).slice(2, 8)}`, username, password, role: 'user', createdAt: nowIso() };
  write('mock_users', [...list, user]);
  const { password: _pw, ...pub } = user;
  return pub;
}

export async function getMe() { await wait(80); return stripUser(currentUser()); }

export async function listRooms() {
  await wait(150);
  currentUser();
  return [...rooms()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createRoom(rawName) {
  await wait();
  const me = currentUser();
  const name = String(rawName).trim();
  if (!name || name.length > RULES.roomNameMax) fail(400, 'VALIDATION_ERROR', 'The request body is invalid.', [{ field: 'name', message: `Must be 1 to ${RULES.roomNameMax} characters.` }]);
  const list = rooms();
  if (list.some((r) => r.name.toLowerCase() === name.toLowerCase())) fail(409, 'ROOM_NAME_TAKEN', 'A room with this name already exists.');
  if (list.length >= MAX_ROOMS) fail(409, 'ROOM_LIMIT_REACHED', 'The maximum number of rooms exists.');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
  const room = { id: `${slug}-${Math.random().toString(36).slice(2, 5)}`, name, maxPeers: 4, createdBy: { id: me.id, username: me.username }, createdAt: nowIso() };
  write('mock_rooms', [...list, room]);
  return room;
}

// Contract: 404 ROOM_NOT_FOUND for unknown ids. Mock deliberately stays lenient (any id works) because mock rooms live in
// ONE browser's localStorage, so a room id copied from another machine would otherwise never be joinable in mock mode.
export async function joinRoom(id) {
  await wait(100);
  currentUser();
  return rooms().find((r) => r.id === id) || { id, name: id, maxPeers: 4, createdBy: null, createdAt: nowIso() };
}

export async function deleteRoom(id) {
  await wait();
  const me = currentUser();
  const room = rooms().find((r) => r.id === id);
  if (!room) fail(404, 'ROOM_NOT_FOUND', 'The room does not exist.');
  if (me.role !== 'admin' && room.createdBy?.id !== me.id) fail(403, 'FORBIDDEN', 'Only the room creator or an admin can delete this room.');
  write('mock_rooms', rooms().filter((r) => r.id !== id));
  const h = history(); delete h[id]; write('mock_messages', h);
}

export async function getHistory(id, { limit = 50, before } = {}) {
  await wait(100);
  currentUser();
  const all = history()[id] || [{ id: 'msg-mock-1', roomId: id, userId: 'system', username: 'system', text: `Mock chat history for "${id}" (the real history comes from GET /api/rooms/:roomId/messages).`, ts: nowIso() }];
  const end = before ? Math.max(0, all.findIndex((m) => m.id === before)) : all.length; // newest page first
  const start = Math.max(0, end - limit);
  const page = all.slice(start, end);
  return { messages: page, hasMore: start > 0, nextBefore: start > 0 ? page[0]?.id ?? null : null };
}

export async function getIceServers() {
  await wait(100);
  currentUser();
  return DEFAULT_ICE_SERVERS; // real API returns STUN + time-limited TURN credentials (re-fetched before each call)
}

export async function getAdminStats() {
  await wait(150);
  const me = currentUser();
  if (me.role !== 'admin') fail(403, 'FORBIDDEN', 'Only admins can view statistics.');
  const total = Object.values(history()).reduce((n, l) => n + l.length, 0);
  return { users: { total: users().length }, rooms: { total: rooms().length }, messages: { total }, realtime: null, generatedAt: nowIso() };
}
