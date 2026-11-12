import { useState } from 'react';
import Icon from '../../components/Icon';
import { adminApi } from '../../api/admin';
import { useFeedEvents } from '../../admin/feed';
import { ErrorBox, PageHead, dateTime, useDebounced, useLoad } from '../../admin/ui';

const ACTIONS = ['settings-change', 'kick', 'ban', 'mute-peer', 'owner-transfer', 'room-close', 'user-disconnect', 'user-deny', 'user-deny-lift', 'announcement', 'config-change', 'global-peer-cap-reduced'];

export default function Audit() {
  const [f, setF] = useState({ action: '', room: '', user: '', limit: 100 });
  const dbf = useDebounced(f, 350);
  const { data, error, loading, reload } = useLoad(() => adminApi.getAudit({ ...dbf, limit: Number(dbf.limit) }), [dbf.action, dbf.room, dbf.user, dbf.limit]);
  const [live, setLive] = useState([]);
  const [open, setOpen] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // new entries arrive through the feed; show the ones that match the filters on top (until the next reload)
  useFeedEvents(['audit'], ({ entry }) => {
    const ok = (!dbf.action || entry.action === dbf.action) && (!dbf.room || entry.room === dbf.room)
      && (!dbf.user || entry.actor.userId === dbf.user || entry.target === dbf.user || entry.actor.username === dbf.user);
    if (ok) setLive((l) => [entry, ...l].slice(0, 200));
  });
  const known = new Set((data || []).map((e) => e.id));
  const rows = [...live.filter((e) => !known.has(e.id)), ...(data || [])];
  const clear = () => { setLive([]); reload(); };

  return (
    <>
      <PageHead title="Audit log" subtitle="Every admin and room-owner action, newest first. New entries appear live.">
        <button className="secondary" onClick={clear}><Icon name="refresh" size={16} /> Reload</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      <div className="toolbar">
        <input list="audit-actions" placeholder="Action (e.g. kick)" value={f.action} onChange={set('action')} />
        <datalist id="audit-actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
        <input placeholder="Room id" value={f.room} onChange={set('room')} />
        <input placeholder="User id or name" value={f.user} onChange={set('user')} />
        <select value={f.limit} onChange={set('limit')} aria-label="Rows"><option value="50">Last 50</option><option value="100">Last 100</option><option value="500">Last 500</option><option value="5000">Last 5000</option></select>
        {(f.action || f.room || f.user) && <button className="secondary" onClick={() => setF({ action: '', room: '', user: '', limit: f.limit })}>Clear filters</button>}
      </div>
      <div className="card table-card">
        <table className="tbl">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Room</th><th>Target</th><th>Result</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{dateTime(e.ts)}</td>
                <td><b>{e.actor?.username}</b> <span className="muted small">{e.actor?.role}</span></td>
                <td><code>{e.action}</code></td>
                <td>{e.room || <span className="muted">–</span>}</td>
                <td>{e.target || <span className="muted">–</span>}</td>
                <td><span className={`pill ${e.result === 'success' ? 'connected' : 'closed'}`}>{e.result}</span></td>
                <td className="details">
                  {e.details && Object.keys(e.details).length ? (
                    <button className="th-btn" onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Show'}</button>
                  ) : <span className="muted">–</span>}
                  {open === e.id && <pre>{JSON.stringify(e.details, null, 2)}</pre>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="7" className="empty-cell">{loading ? 'Loading…' : 'No audit entries match.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
