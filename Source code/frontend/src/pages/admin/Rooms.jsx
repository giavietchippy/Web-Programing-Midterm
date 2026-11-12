import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import { adminApi } from '../../api/admin';
import { useFeedEvents } from '../../admin/feed';
import { ErrorBox, PageHead, SORT_ARROW, dateTime, shortId, since, useDebounced, useLoad, useSort } from '../../admin/ui';
import { AnnounceModal, CloseRoomModal, RoomSettingsModal } from '../../components/admin/RoomModals';

const GET = {
  id: (r) => r.id.toLowerCase(),
  peers: (r) => r.peerCount,
  owner: (r) => r.owner?.userId || '',
  created: (r) => new Date(r.createdAt).getTime()
};

export default function Rooms() {
  const { data, error, loading, reload } = useLoad(() => adminApi.listRooms(), []);
  const [q, setQ] = useState('');
  const query = useDebounced(q).trim().toLowerCase();
  const { sort, toggle, apply } = useSort('created', 'desc');
  const [modal, setModal] = useState(null); // { kind: 'close' | 'settings' | 'announce', room }

  // the list is "live": any room/peer event triggers one debounced refetch
  const timer = useRef(null);
  useFeedEvents(['room-created', 'room-updated', 'room-closed', 'peer-joined', 'peer-left'], () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reload(true), 400);
  });

  const rows = apply((data || []).filter((r) => !query || r.id.toLowerCase().includes(query) || (r.owner?.userId || '').toLowerCase().includes(query)), GET);
  const Th = ({ k, children }) => <th><button className="th-btn" onClick={() => toggle(k)}>{children}{SORT_ARROW(sort.key === k, sort.dir)}</button></th>;

  return (
    <>
      <PageHead title="Rooms" subtitle={`${data?.length ?? 0} live room(s). The list updates by itself.`}>
        <button className="secondary" onClick={() => setModal({ kind: 'announce' })}><Icon name="megaphone" size={16} /> Announce to all</button>
        <button className="secondary" onClick={() => reload()}><Icon name="refresh" size={16} /> Refresh</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      <div className="toolbar"><div className="search"><Icon name="search" size={16} /><input placeholder="Search by room id or owner id" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="card table-card">
        <table className="tbl">
          <thead><tr><Th k="id">Room</Th><Th k="owner">Owner</Th><Th k="peers">Peers</Th><th>Settings</th><Th k="created">Created</Th><th className="right">Actions</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/admin/rooms/${encodeURIComponent(r.id)}`}><b>{r.id}</b></Link></td>
                <td title={r.owner?.userId || ''}>{r.owner?.userId ? shortId(r.owner.userId) : <span className="muted">no owner</span>}</td>
                <td>{r.peerCount} / {r.settings.maxPeers}</td>
                <td className="chips-cell">
                  {r.settings.locked && <span className="pill closed">locked</span>}
                  {!r.settings.chatEnabled && <span className="pill new">chat off</span>}
                  {r.settings.screenShare === 'owner' && <span className="pill new">screen: owner</span>}
                  {r.settings.locked === false && r.settings.chatEnabled && r.settings.screenShare === 'everyone' && <span className="muted">default</span>}
                </td>
                <td title={dateTime(r.createdAt)}>{since(r.createdAt)} ago</td>
                <td className="right actions">
                  <Link className="btn-link secondary" to={`/admin/rooms/${encodeURIComponent(r.id)}`}>Details</Link>
                  <button className="secondary" onClick={() => setModal({ kind: 'settings', room: r })}>Settings</button>
                  <button className="secondary" onClick={() => setModal({ kind: 'announce', room: r.id })}>Announce</button>
                  <button className="danger" onClick={() => setModal({ kind: 'close', room: r.id })}>Close</button>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="6" className="empty-cell">{loading ? 'Loading…' : query ? 'No room matches your search.' : 'No live rooms right now.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {modal?.kind === 'settings' && <RoomSettingsModal room={modal.room} onClose={() => setModal(null)} onDone={() => reload(true)} />}
      {modal?.kind === 'announce' && <AnnounceModal room={modal.room} onClose={() => setModal(null)} />}
      {modal?.kind === 'close' && <CloseRoomModal room={modal.room} onClose={() => setModal(null)} onDone={() => reload(true)} />}
    </>
  );
}
