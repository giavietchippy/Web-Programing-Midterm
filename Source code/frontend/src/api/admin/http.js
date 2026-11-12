// Tiny fetch wrapper for the Administrator pages (same error shape as api/real.js).
// Every admin request carries "Authorization: Bearer <JWT>".
import { getAuth } from '../storage';
import { ApiError, notifyAuthError, isAuthError } from '../errors';

export async function adminRequest(base, path, { method = 'GET', body, query } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const a = getAuth();
  if (a?.token) headers.Authorization = `Bearer ${a.token}`;
  let url = base + path;
  if (query) {
    const q = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(`Cannot reach ${base}. Is the server running? (or set USE_MOCK_ADMIN=true)`, { code: 'NETWORK' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* 204 / empty body */ }
  if (!res.ok) {
    let msg = data?.message || data?.error || `HTTP ${res.status}`;
    if (res.status === 403) msg = `${msg} (your token must carry the "admin" role)`;
    if (res.status === 429) msg = `Too many requests.${res.headers.get('Retry-After') ? ` Try again in ${res.headers.get('Retry-After')}s.` : ''}`;
    const err = new ApiError(msg, { status: res.status, code: data?.error || `HTTP_${res.status}`, details: data?.details || null });
    if (isAuthError(err)) notifyAuthError(err);
    throw err;
  }
  return data;
}
