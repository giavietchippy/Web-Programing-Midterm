// Live admin feed (ws://host/ws/admin) shared by every admin page.
// Events: stats (every 2 s), room-created, room-updated, room-closed, peer-joined, peer-left, audit.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { adminApi } from '../api/admin';

const Ctx = createContext(null);
const MAX_POINTS = 60; // 2 minutes of history at one point per 2 s

export function AdminFeedProvider({ children }) {
  const [status, setStatus] = useState('connecting'); // connecting | live | down
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const subs = useRef(new Set());

  useEffect(() => {
    const close = adminApi.openFeed((ev) => {
      if (ev.type === 'stats') {
        const { type: _t, ...st } = ev;
        setStats(st);
        setHistory((h) => [...h.slice(-(MAX_POINTS - 1)), { t: Date.now(), ...st }]);
      }
      subs.current.forEach((fn) => fn(ev));
    }, setStatus);
    return close;
  }, []);

  const subscribe = useCallback((fn) => { subs.current.add(fn); return () => subs.current.delete(fn); }, []);
  const value = useMemo(() => ({ status, stats, history, subscribe }), [status, stats, history, subscribe]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useFeed = () => useContext(Ctx);

/** Call `handler(event)` for feed events whose type is in `types` (handler can change every render). */
export function useFeedEvents(types, handler) {
  const feed = useFeed();
  const h = useRef(handler);
  h.current = handler;
  const key = types.join(',');
  useEffect(() => feed.subscribe((ev) => { if (types.includes(ev.type)) h.current(ev); }), [feed.subscribe, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
