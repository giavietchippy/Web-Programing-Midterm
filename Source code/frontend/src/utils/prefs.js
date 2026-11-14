// "Force TURN relay" = iceTransportPolicy:'relay' (demo of STUN-only vs TURN fallback)
export const getForceRelay = () => localStorage.getItem('forceRelay') === '1';
export const setForceRelay = (v) => localStorage.setItem('forceRelay', v ? '1' : '0');

// Chosen audio devices ('' = system default). deviceIds are per-browser, so a stale id is simply ignored later.
const read = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* storage blocked */ } };
export const getMicId = () => read('micId');
export const setMicId = (v) => write('micId', v);
export const getSpeakerId = () => read('speakerId');
export const setSpeakerId = (v) => write('speakerId', v);
