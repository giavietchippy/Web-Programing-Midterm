// "Force TURN relay" = iceTransportPolicy:'relay' (demo of STUN-only vs TURN fallback)
export const getForceRelay = () => localStorage.getItem('forceRelay') === '1';
export const setForceRelay = (v) => localStorage.setItem('forceRelay', v ? '1' : '0');
