import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { RoleBadges } from '../../components/RoleBadge';
import { adminApi } from '../../api/admin';
import { useFeedEvents } from '../../admin/feed';
import { ConfirmModal, ErrorBox, PageHead, dateTime, since, useAction, useLoad } from '../../admin/ui';
import { AnnounceModal, CloseRoomModal, RoomSettingsModal } from '../../components/admin/RoomModals';

const MEDIA = [['camera', 'video', 'videoOff'], ['microphone', 'mic', 'micOff'], ['screen', 'screen', 'screen']];

export default function RoomDetail() {
  const { roomId } = useParams();
  const nav = useNavigate();
  const { data: room, error, loading, reload } = useLoad(() => adminApi.getRoom(roomId), [roomId]);
  const { run, busy } = useAction();
  const [modal, setModal] = useState(null);
  const [kick, setKick] = useState(null); // { peer, ban }

  const timer = useRef(null);
  useFeedEvents(['room-updated', 'peer-joined', 'peer-left', 'room-closed'], (ev) => {
    const id = typeof ev.room === 'string' ? ev.room : ev.room?.id; // room-updated carries a summary, the others a room id
    if (id !== roomId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reload(true), 400);
  });

  const closedGone = error?.code === 'ROOM_CLOSED' || error?.status === 404;
  const ownerUserId = room?.owner?.userId;
  const act = (fn, ok) => run(async () => { await fn(); reload(true); }, ok);

  return (
    <>
      <PageHead title={`Room ${roomId}`} subtitle="Participants, their media state and moderation actions.">
        <button className="secondary" onClick={() => nav('/admin/rooms')}><Icon name="arrowLeft" size={16} /> All rooms</button>
        <button onClick={() => nav(`/room/${encodeURIComponent(roomId)}`)} disabled={!room}><Icon name="video" size={16} /> Join the room</button>
      </PageHead>
      {closedGone ? (
        <div className="card empty"><b>This room no longer exists</b>It was closed or everyone left. <Link to="/admin/rooms">Back to the rooms list</Link>.</div>
      ) : <ErrorBox error={error} onRetry={reload} />}
      {loading && !room && !error && <p className="muted">Loading…</p>}
      {room && (
        <>
          <section className="card">
            <div className="row">
              <div className="kv grow">
                <span>Owner</span><b>{ownerUserId ? (room.peers.find((p) => p.userId === ownerUserId)?.username || ownerUserId) : 'none yet'}</b>
                <span>Peers</span><b>{room.peerCount} / {room.settings.maxPeers}</b>
                <span>Created</span><b>{dateTime(room.createdAt)} ({since(room.createdAt)} ago)</b>
                <span>Settings</span>
                <b className="chips-cell">
                  <span className={`pill ${room.settings.locked ? 'closed' : 'connected'}`}>{room.settings.locked ? 'locked' : 'open'}</span>
                  <span className={`pill ${room.settings.chatEnabled ? 'connected' : 'new'}`}>chat {room.settings.chatEnabled ? 'on' : 'off'}</span>
                  <span className="pill">screen: {room.settings.screenShare === 'owner' ? 'owner only' : 'everyone'}</span>
                </b>
              </div>
              <div className="actions col">
                <button className="secondary" onClick={() => setModal('settings')}>Change settings</button>
                <button className="secondary" onClick={() => setModal('announce')}>Announce</button>
                <button className="danger" onClick={() => setModal('close')}>Close room</button>
              </div>
            </div>
          </section>

          <div className="card table-card">
            <table className="tbl">
              <thead><tr><th>Participant</th><th>Role</th><th>Media</th><th>Joined</th><th className="right">Actions</th></tr></thead>
              <tbody>
                {room.peers.map((p) => {
                  const roles = [...(p.userId === ownerUserId ? ['owner'] : []), ...(p.role === 'admin' ? ['admin'] : [])];
                  return (
                    <tr key={p.peerId}>
                      <td><b>{p.username}</b><div className="muted small">{p.userId} · {p.peerId}</div></td>
                      <td>{roles.length ? <RoleBadges roles={roles} /> : <span className="muted">participant</span>}</td>
                      <td>
                        <span className="media-row">
                          {MEDIA.map(([kind, on, off]) => {
                            const st = p.mediaState?.find((m) => m.kind === kind);
                            return <span key={kind} className={`media-ico${st?.active ? ' on' : ''}`} title={`${kind}: ${st?.active ? 'active' : 'off / unknown'}`}><Icon name={st?.active ? on : off} size={16} /></span>;
                          })}
                        </span>
                      </td>
                      <td title={dateTime(p.joinedAt)}>{since(p.joinedAt)} ago</td>
                      <td className="right actions">
                        <button className="secondary" disabled={busy} onClick={() => act(() => adminApi.muteInRoom(roomId, { peerId: p.peerId, kind: 'audio' }), `Mute request sent to ${p.username}.`)}>Mute</button>
                        <button className="secondary" disabled={busy} onClick={() => act(() => adminApi.muteInRoom(roomId, { peerId: p.peerId, kind: 'video' }), `Camera-off request sent to ${p.username}.`)}>Stop camera</button>
                        <button className="secondary" disabled={busy} onClick={() => act(() => adminApi.muteInRoom(roomId, { peerId: p.peerId, kind: 'screen' }), `Screen-share stop request sent to ${p.username}.`)}>Stop screen</button>
                        <button className="secondary" disabled={busy || p.userId === ownerUserId} onClick={() => act(() => adminApi.transferOwner(roomId, p.peerId), `${p.username} is now the owner.`)}>Make owner</button>
                        <button className="danger" onClick={() => setKick({ peer: p, ban: false })}>Kick</button>
                        <button className="danger" onClick={() => setKick({ peer: p, ban: true })}>Ban</button>
                      </td>
                    </tr>
                  );
                })}
                {!room.peers.length && <tr><td colSpan="5" className="empty-cell">Nobody is in this room right now.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted small">Mute / stop requests are sent to the participant's browser, which turns its own track off (the server cannot force it).</p>
        </>
      )}
      {modal === 'settings' && room && <RoomSettingsModal room={room} onClose={() => setModal(null)} onDone={() => reload(true)} />}
      {modal === 'announce' && <AnnounceModal room={roomId} onClose={() => setModal(null)} />}
      {modal === 'close' && <CloseRoomModal room={roomId} onClose={() => setModal(null)} onDone={() => nav('/admin/rooms')} />}
      {kick && (
        <ConfirmModal title={`${kick.ban ? 'Kick and ban' : 'Kick'} ${kick.peer.username}?`} confirmText={kick.ban ? 'Kick and ban' : 'Kick'} busy={busy}
          onClose={() => setKick(null)}
          onConfirm={async () => { if (await act(() => adminApi.kickFromRoom(roomId, { peerId: kick.peer.peerId, ban: kick.ban }), `${kick.peer.username} removed${kick.ban ? ' and banned' : ''}.`)) setKick(null); }}>
          <p className="muted">{kick.ban ? 'They cannot rejoin this room until it is closed.' : 'They are removed now and may rejoin.'}</p>
        </ConfirmModal>
      )}
    </>
  );
}
