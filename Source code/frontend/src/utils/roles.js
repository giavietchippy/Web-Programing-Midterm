import { parseJwt } from './jwt';

// Site role of the logged-in user. token-contract v1.1 puts it in the JWT claim `role`; the platform's REST login
// (v1.0) returns it in `user.role` instead, so we trust the claim when present and fall back to the stored login role.
export function siteRole(auth) {
  if (!auth) return 'user';
  const claim = parseJwt(auth.token)?.role;
  if (claim === 'admin' || claim === 'user') return claim;
  return auth.role === 'admin' ? 'admin' : 'user';
}
export const isAdminAuth = (auth) => siteRole(auth) === 'admin';
