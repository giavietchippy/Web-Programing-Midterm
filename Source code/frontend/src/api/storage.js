// sessionStorage = per-tab, so you can log in as different users in different tabs
// to test a two-person call on one machine.
const KEY = 'wrtc_auth';
export const getAuth = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
export const setAuth = (a) => sessionStorage.setItem(KEY, JSON.stringify(a));
export const clearAuth = () => sessionStorage.removeItem(KEY);
