// Small shared helpers for the Administrator pages.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import Modal from '../components/Modal';

/** Load data with loading/error state; optional polling. `reload()` refetches, `silent` keeps the table on screen. */
export function useLoad(fn, deps = [], { interval = 0, enabled = true } = {}) {
  const [st, setSt] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setSt((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      if (mine === seq.current) setSt({ data, error: null, loading: false });
    } catch (e) {
      if (mine === seq.current) setSt((s) => ({ data: s.data, error: e, loading: false }));
    }
  }, []);
  useEffect(() => {
    if (!enabled) return undefined;
    reload();
    if (!interval) return undefined;
    const t = setInterval(() => reload(true), interval);
    return () => clearInterval(t);
  }, [...deps, interval, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...st, reload };
}

// ----- toasts -----
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((kind, text) => {
    const id = Math.random().toString(36).slice(2);
    setItems((l) => [...l, { id, kind, text }].slice(-4));
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="notices admin-toasts">
        {items.map((n) => <div key={n.id} className={`notice ${n.kind}`} onClick={() => setItems((l) => l.filter((x) => x.id !== n.id))}>{n.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/** Runs an async admin action, shows a success/error toast, returns true on success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okText) => {
    setBusy(true);
    try { await fn(); if (okText) toast('ok', okText); return true; }
    catch (e) { toast('error', e.code && e.code !== 'ERROR' ? `${e.message}` : e.message); return false; }
    finally { setBusy(false); }
  }, [toast]);
  return { run, busy };
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner error">
      <span><Icon name="alert" size={16} /> {error.message}{error.code && !['ERROR', 'NETWORK'].includes(error.code) ? ` (${error.code})` : ''}</span>
      {onRetry && <button className="secondary" onClick={() => onRetry()}>Retry</button>}
    </div>
  );
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      <div className="row">{children}</div>
    </div>
  );
}

export function ConfirmModal({ title, children, confirmText = 'Confirm', danger = true, busy = false, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="secondary" onClick={onClose}>Cancel</button><button className={danger ? 'danger' : ''} disabled={busy} onClick={onConfirm}>{busy ? 'Please wait…' : confirmText}</button></>}>
      {children}
    </Modal>
  );
}

// ----- formatting -----
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
export const since = (iso) => (iso ? duration((Date.now() - new Date(iso).getTime()) / 1000) : '–');
export const dateTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleString('en-GB', { hour12: false });
};
export const shortId = (id) => (id ? (String(id).length > 14 ? `${String(id).slice(0, 12)}…` : String(id)) : '–');

/** Tiny line chart (no dependency). `series` = [{ data:number[], color, label }] drawn over the same x range. */
export function LineChart({ series, height = 120 }) {
  const w = 600;
  const n = Math.max(2, ...series.map((s) => s.data.length));
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const pts = (data) => data.map((v, i) => `${(i / (n - 1)) * w},${height - 6 - (v / max) * (height - 12)}`).join(' ');
  return (
    <div className="linechart">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="Live chart">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} stroke="#d6e4f2" strokeDasharray="4 6" />)}
        {series.map((s) => s.data.length > 1 && <polyline key={s.label} points={pts(s.data)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}<span className="muted">peak scale: {max}</span></div>
    </div>
  );
}

export const useDebounced = (value, ms = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

export const SORT_ARROW = (active, dir) => (active ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
export function useSort(initialKey, initialDir = 'asc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const apply = useMemo(() => (rows, getters) => {
    const g = getters[sort.key] || ((r) => r[sort.key]);
    return [...rows].sort((a, b) => {
      const x = g(a), y = g(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [sort]);
  return { sort, toggle, apply };
}
