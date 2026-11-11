import Icon from '../components/Icon';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isMock } from '../api';
import { useAuth } from '../context/AuthContext';
import { getForceRelay, setForceRelay } from '../utils/prefs';

export default function LobbyPage() {
  const { auth, signOut } = useAuth();
  const nav = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [relay, setRelay] = useState(getForceRelay());
  const [stats, setStats] = useState(null);
  const isAdmin = auth.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try { setRooms(await api.listRooms()); } catch (e) { setErr(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isAdmin) api.getAdminStats().then(setStats).catch(() => setStats(null)); }, [isAdmin]);

  // Contract: DELETE /rooms/:id is allowed for the room creator and for admins.
  const canDelete = (r) => isAdmin || (r.createdBy?.id && r.createdBy.id === auth.userId);
  const remove = async (r) => {
    if (!window.confirm(`Delete room "${r.name}" and its chat history?`)) return;
    try { await api.deleteRoom(r.id); await load(); } catch (e) { setErr(e.message); }
  };

  const go = (id) => nav(`/room/${encodeURIComponent(id)}`);
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { const r = await api.createRoom(name.trim()); go(r.id); } catch (e2) { setErr(e2.message); }
  };

  const ROOM_COLORS = ['linear-gradient(135deg,#ff7a45,#ffb347)', 'linear-gradient(135deg,#7c4dff,#b388ff)', 'linear-gradient(135deg,#14a65a,#6ee7b7)', 'linear-gradient(135deg,#1f6fff,#10b9d8)', 'linear-gradient(135deg,#e91e8c,#ff8ac1)'];
  const colorOf = (txt) => ROOM_COLORS[[...String(txt)].reduce((h, c) => h + c.charCodeAt(0), 0) % ROOM_COLORS.length];

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Icon name="video" size={20} /></span>WebRTC Meet</div>
        <span className="grow" />
        <span className="user-chip"><i>{(auth.username || '?').charAt(0).toUpperCase()}</i>{auth.username}</span>
        <button className="secondary" onClick={signOut}>Log out</button>
      </header>

      <main className="lobby">
        {isMock && <div className="banner info">Mock REST mode is ON (rooms are stored in your browser). Real signaling still uses the WebSocket server.</div>}
        {err && <div className="banner error">{err}</div>}

        <section className="hero">
          <div>
            <h1>Hi {auth.username}, start a meeting</h1>
            <p>Name your room and jump in. Share the invite link and up to 4 people can talk, chat and send files straight between browsers.</p>
            <form className="create-form" onSubmit={create}>
              <input placeholder="Room name, e.g. Team standup" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="warm">Create &amp; join</button>
            </form>
            <div className="chips">
              <span className="chip"><Icon name="video" size={15} /> HD video</span>
              <span className="chip"><Icon name="lock" size={15} /> DTLS-SRTP encrypted</span>
              <span className="chip"><Icon name="clip" size={15} /> P2P file transfer</span>
            </div>
          </div>
          <div className="preview" aria-hidden="true">
            <div className="pv-grid">
              <div className="pv"><b>A</b><span>Anna</span></div>
              <div className="pv"><b>B</b><span>Bao</span></div>
              <div className="pv"><b>C</b><span>Chi</span></div>
              <div className="pv"><b>D</b><span>Duy</span></div>
            </div>
            <div className="pv-bar"><i><Icon name="mic" size={16} /></i><i><Icon name="video" size={16} /></i><i><Icon name="screen" size={16} /></i><i><Icon name="chat" size={16} /></i><i><Icon name="leave" size={16} /></i></div>
          </div>
        </section>

        <div className="two-col">
          <section className="card">
            <h3>Join by ID</h3>
            <p className="muted">Got a room ID from a friend? Paste it here.</p>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (joinId.trim()) go(joinId.trim()); }}>
              <input placeholder="Room ID" value={joinId} onChange={(e) => setJoinId(e.target.value)} />
              <button>Join</button>
            </form>
          </section>

          {isMock && <section className="card">
            <h3>Quick demo</h3>
            <p className="muted">Open this room in two tabs (log in as different users, e.g. <code>demo</code> and <code>admin</code>) to try a two-person call.</p>
            <button onClick={() => go('demo-room')}>Join “demo-room”</button>
            <label className="check">
              <input type="checkbox" checked={relay} onChange={(e) => { setRelay(e.target.checked); setForceRelay(e.target.checked); }} />
              Force TURN relay (iceTransportPolicy = relay) — to demo STUN-only vs TURN fallback. Takes effect on next join.
            </label>
          </section>}
        </div>

        {isAdmin && stats && (
          <section className="card wide">
            <h3>Admin statistics</h3>
            <div className="kv">
              <span>Users</span><b>{stats.users?.total ?? '–'}</b>
              <span>Rooms</span><b>{stats.rooms?.total ?? '–'}</b>
              <span>Messages</span><b>{stats.messages?.total ?? '–'}</b>
              <span>Real-time</span><b>{stats.realtime ? `${stats.realtime.connections} connections · ${stats.realtime.rooms} rooms · ${stats.realtime.peers} peers` : 'unavailable'}</b>
            </div>
          </section>
        )}

        <section className="card wide">
          <div className="row"><h3 className="grow">Rooms</h3><button className="secondary" onClick={load}>Refresh</button></div>
          {loading && <p className="muted">Loading…</p>}
          {!loading && rooms.length === 0 && <div className="empty"><b>No rooms yet</b>Create the first one above and it will show up here.</div>}
          <ul className="rooms">
            {rooms.map((r) => (
              <li key={r.id}>
                <div>
                  <span className="room-ico" style={{ background: colorOf(r.id) }}>{(r.name || r.id || '?').charAt(0).toUpperCase()}</span>
                  <span className="room-name"><b>{r.name}</b><span className="muted">{r.id}{r.createdBy?.username ? ` · by ${r.createdBy.username}` : ''}</span></span>
                </div>
                <div className="row">
                  {canDelete(r) && <button className="danger" onClick={() => remove(r)}>Delete</button>}
                  <button onClick={() => go(r.id)}>Join</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
