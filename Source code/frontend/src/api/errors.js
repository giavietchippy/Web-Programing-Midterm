// Error type shared by real.js and mock.js. Contract v1.0 error body: { error, message, details? }.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'ERROR', details = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

// AuthContext registers a handler here; it is called on 401 INVALID_TOKEN / TOKEN_EXPIRED
// (contract: "log in again after TOKEN_EXPIRED", there is no refresh endpoint).
let authErrorHandler = null;
export const setAuthErrorHandler = (fn) => { authErrorHandler = fn; };
export const notifyAuthError = (err) => { try { authErrorHandler?.(err); } catch { /* ignore */ } };

export const isAuthError = (e) => e?.status === 401 && (e.code === 'INVALID_TOKEN' || e.code === 'TOKEN_EXPIRED');
