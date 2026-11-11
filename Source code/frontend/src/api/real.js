import { config } from '../config';
import { E } from './endpoints';
import { getAuth } from './storage';
import { parseJwt } from '../utils/jwt';
import { ApiError, notifyAuthError, isAuthError } from './errors';

function describe(data, status, res) {
  let msg = data?.message || data?.error || `HTTP ${status}`;
  if (Array.isArray(data?.details) && data.details.length) {
    msg += ' ' + data.details.map((d) => (d.field ? `${d.field}: ${d.message}` : d.message)).join('; ');
  }
  if (status === 429) {
    const ra = res.headers.get('Retry-After');
    msg = `Too many requests.${ra ? ` Try again in ${ra}s.` : ''}`;
  }
  return msg;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const a = getAuth();
    if (a?.token) headers.Authorization = `Bearer ${a.token}`;
  }
  let res;
  try {
    res = await fetch(config.API_BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(`Cannot reach the REST API (${config.API_BASE}). Is the backend running? Or set USE_MOCK_API=true.`, { code: 'NETWORK' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* 204 or empty body */ }
  if (!res.ok) {
    const err = new ApiError(describe(data, res.status, res), {
      status: res.status,
      code: data?.error || `HTTP_${res.status}`,
      details: data?.details || null,
      retryAfter: res.headers.get('Retry-After')
    });
    if (auth && isAuthError(err)) notifyAuthError(err);
    throw err;
  }
  return data;
}

// POST /login -> { token, tokenType, expiresIn, user:{id,username,role} }
export async function login(username, password) {
  const d = await request(E.login, { method: 'POST', body: { username, password }, auth: false });
  const p = parseJwt(d.token) || {}; // payload: userId, username, iat, exp (no role in the token)
  return {
    token: d.token,
    userId: d.user?.id || p.userId,
    username: d.user?.username || p.username || username,
    role: d.user?.role || 'user'
  };
}

// POST /register -> 201 { user }  (no token: the caller logs in afterwards)
export const register = async (username, password) => (await request(E.register, { method: 'POST', body: { username, password }, auth: false })).user;

// GET /me -> { user:{id,username,role} }
export const getMe = async () => (await request(E.me)).user;

export const listRooms = async () => (await request(E.rooms)).rooms || [];
export const createRoom = async (name) => (await request(E.rooms, { method: 'POST', body: { name } })).room;
export const joinRoom = async (id) => (await request(E.join(id), { method: 'POST' })).room;
export const deleteRoom = (id) => request(E.room(id), { method: 'DELETE' });

// GET /rooms/:id/messages -> { messages (oldest->newest), hasMore, nextBefore }
export async function getHistory(id, { limit = 50, before } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set('before', before);
  const d = await request(`${E.history(id)}?${q}`);
  return { messages: d.messages || [], hasMore: !!d.hasMore, nextBefore: d.nextBefore ?? null };
}

// GET /config/ice -> { iceServers, ttl, expiresAt }. TURN credentials are time-limited: call before each call, never cache.
export async function getIceServers() {
  const d = await request(E.ice);
  return d?.iceServers || [];
}

// GET /admin/stats (admin only) -> { users, rooms, messages, realtime|null, generatedAt }
export const getAdminStats = () => request(E.adminStats);
