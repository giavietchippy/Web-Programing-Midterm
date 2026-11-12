import { useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { RoleBadges } from '../../components/RoleBadge';
import { adminApi } from '../../api/admin';
import { ConfirmModal, ErrorBox, PageHead, SORT_ARROW, shortId, since, useAction, useDebounced, useLoad, useSort } from '../../admin/ui';
import Modal from '../../components/Modal';

const PRESETS = [5, 15, 60, 1440];

function DenyModal({ user, onClose, onDone }) {
  const [minutes, setMinutes] = useState(15);
  const { run, busy } = useAction();
  const go = async () => { if (await run(() => adminApi.denyUser(user.userId, Number(minutes)), `${user.username} is denied for ${minutes} min.`)) { onDone(); onClose(); } };
  return (
    <Modal title={`Deny ${user.username}`} onClose={onClose}
      footer={<><button className="secondary" onClick={onClose}>Cancel</button><button className="danger" disabled={busy || !(Number(minutes) >= 1)} onClick={go}>{busy ? 'Working…' : 'Deny and disconnect'}</button></>}>
      <p className="muted">All of this user's sockets are closed with <code>USER_DENIED</code> (4006) and reconnecting is refused for the chosen time. The account itself stays enabled.</p>
      <label>Deny for (minutes)<input type="number" min="1" max="525600" value={minutes} onChange={(e) => setMinutes(e.target.value)} autoFocus /></label>
      <div className="row">{PRESETS.map((m) => <button key={m} type="button" className="secondary" onClick={() => setMinutes(m)}>{m >= 60 ? `${m / 60} h` : `${m} min`}</button>)}</div>
    </Modal>
  );
}

export default function Connections() {
  const [auto, setAuto] = useState(true);
  const { data, error, loading, reload } = useLoad(() => adminApi.listConnections(), [], { interval: auto ? 3000 : 0 });
  const [q, setQ] = useState('');
  const query = useDebounced(q).trim().toLowerCase();
  const { sort, toggle, apply } = useSort('user');
  const { run, busy } = useAction();
  const [modal, setModal] = useState(null);

  const rows = apply((data || []).filter((c) => !query || c.user.username.toLowerCase().includes(query) || c.user.userId.toLowerCase().includes(query) || (c.ip || '').includes(query) || (c.room || '').toLowerCase().includes(query)), {
    user: (c) => c.user.username.toLowerCase(), room: (c) => c.room || '', rate: (c) => c.messagesPerSecond, since: (c) => new Date(c.since).getTime(), ip: (c) => c.ip || ''
  });
  const Th = ({ k, children }) => <th><button className="th-btn" onClick={() => toggle(k)}>{children}{SORT_ARROW(sort.key === k, sort.dir)}</button></th>;

  return (
    <>
      <PageHead title="Connections" subtitle={`${data?.length ?? 0} live socket(s). Actions apply to every socket of that user.`}>
        <label className="check inline"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Auto-refresh (3 s)</label>
        <button className="secondary" onClick={() => reload()}><Icon name="refresh" size={16} /> Refresh</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      <div className="toolbar"><div className="search"><Icon name="search" size={16} /><input placeholder="Search by user, IP or room" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="card table-card">
        <table className="tbl">
          <thead><tr><Th k="user">User</Th><Th k="ip">IP</Th><Th k="room">Room</Th><Th k="since">Connected</Th><Th k="rate">Msg / s</Th><th className="right">Actions</th></tr></thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={`${c.user.userId}-${c.since}-${i}`}>
                <td><b>{c.user.username}</b> {c.user.role === 'admin' && <RoleBadges roles={['admin']} />}<div className="muted small" title={c.user.userId}>{shortId(c.user.userId)}</div></td>
                <td>{c.ip || '–'}</td>
                <td>{c.room ? <Link to={`/admin/rooms/${encodeURIComponent(c.room)}`}>{c.room}</Link> : <span className="muted">lobby</span>}</td>
                <td>{since(c.since)}</td>
                <td><span className={c.messagesPerSecond >= 20 ? 'warn' : ''}>{c.messagesPerSecond}</span></td>
                <td className="right actions">
                  <button className="secondary" disabled={busy} onClick={() => setModal({ kind: 'disconnect', user: c.user })}>Disconnect</button>
                  <button className="danger" disabled={busy} onClick={() => setModal({ kind: 'deny', user: c.user })}>Deny for N min</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="6" className="empty-cell">{loading ? 'Loading…' : 'No live connections.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {modal?.kind === 'deny' && <DenyModal user={modal.user} onClose={() => setModal(null)} onDone={() => reload(true)} />}
      {modal?.kind === 'disconnect' && (
        <ConfirmModal title={`Disconnect ${modal.user.username}?`} confirmText="Disconnect" busy={busy} onClose={() => setModal(null)}
          onConfirm={async () => { if (await run(() => adminApi.disconnectUser(modal.user.userId), `${modal.user.username} disconnected.`)) { setModal(null); reload(true); } }}>
          <p className="muted">Closes all of this user's sockets once. They can reconnect right away; use <b>Deny for N min</b> to stop that.</p>
        </ConfirmModal>
      )}
    </>
  );
}
