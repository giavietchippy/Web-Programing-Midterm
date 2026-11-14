import Icon from '../components/Icon';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { DEFAULT_ICE_SERVERS } from '../config';
import { useAuth } from '../context/AuthContext';
import { useSessionState } from '../hooks/useSessionState';
import { getForceRelay } from '../utils/prefs';
import { closeInfo } from '../utils/closeCodes';
import { isExpired } from '../utils/jwt';
import { probeSocket } from '../utils/probeSocket';
import { RoomSession, badgesFor, deriveRoles } from '../webrtc/RoomSession';
import ChatPanel from '../components/ChatPanel';
import ControlsBar from '../components/ControlsBar';
import FilesPanel from '../components/FilesPanel';
import IcePanel from '../components/IcePanel';
import StatsPanel from '../components/StatsPanel';
import VideoTile from '../components/VideoTile';
import PeoplePanel from '../components/PeoplePanel';
import RoomSettingsPanel from '../components/RoomSettingsPanel';
import PeerManageModal from '../components/PeerManageModal';
import DeviceSettingsModal from '../components/DeviceSettingsModal';
import Modal from '../components/Modal';
import { RoleBadges } from '../components/RoleBadge';

const STATUS_TEXT = {
  idle: 'Starting…',
  media: 'Waiting for camera/microphone permission…',
  connecting: 'Connecting to signaling server…',
  joining: 'Joining room…',
  connected: 'Connected',
  closed: 'Disconnected'
};

const JOIN_ERROR_TITLE = {
  ROOM_LOCKED: 'This room is locked',
  ROOM_FULL: 'This room is full',
  BANNED_FROM_ROOM: 'You are banned from this room',
  MAX_ROOMS_REACHED: 'The server cannot create more rooms',
  ROOM_CLOSED: 'This room is closed'
};

export default function RoomPage() {
  const { roomId } = useParams();
  const { auth, signOut } = useAuth();
  const nav = useNavigate();
  const [boot, setBoot] = useState({ phase: 'loading', message: '' });
  const [session, setSession] = useState(null);
  const [room, setRoom] = useState(null);
  const [tab, setTab] = useState('chat');
  const [panelOpen, setPanelOpen] = useState(true);
  const [manage, setManage] = useState(null); // participant being managed (owner/admin only)
  const [endOpen, setEndOpen] = useState(false);
  const [endReason, setEndReason] = useState('');
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(null); // key of the tile enlarged into the main area (null = plain grid)
  const state = useSessionState(session);

  useEffect(() => {
    let disposed = false;
    let s = null;
    (async () => {
      setBoot({ phase: 'loading', message: '' });
      setSession(null);
      // Refused token: do not enter the room at all (no camera prompt, no REST call, no real join).
      // Expired is known from the token itself; invalid (4001) / denied (4006) only the server can tell.
      const refused = (code) => closeInfo(code) && setBoot({ phase: 'blocked', code, message: closeInfo(code).message });
      if (isExpired(auth.token)) { refused(4002); return; }
      const probe = await probeSocket(auth.token);
      if (disposed) return;
      if (!probe.ok) { refused(probe.code); return; }
      try {
        const r = await api.joinRoom(roomId); // REST check: room exists / user may enter. Then WS join uses room.id
        if (!disposed) setRoom(r);
      } catch (e) {
        if (!disposed) setBoot({ phase: 'error', message: `Cannot join room via REST API: ${e.message}` });
        return;
      }
      let iceServers = DEFAULT_ICE_SERVERS;
      let warn = null;
      try {
        const r = await api.getIceServers();
        if (Array.isArray(r) && r.length) iceServers = r;
      } catch (e) {
        warn = `Could not load ICE config (${e.message}). Using public STUN only - TURN fallback unavailable.`;
      }
      if (disposed) return;
      s = new RoomSession({ room: roomId, token: auth.token, username: auth.username, iceServers, forceRelay: getForceRelay() });
      if (warn) s.notify('warn', warn);
      setSession(s);
      setBoot({ phase: 'ready', message: '' });
      api.getHistory(roomId).then((h) => s.loadHistory(h.messages)).catch(() => {});
      s.start();
    })();
    return () => { disposed = true; s?.close(); };
  }, [roomId, auth.token, auth.username]);

  const leave = () => { session?.close(); nav('/'); };

  if (boot.phase === 'loading') return <div className="center-page"><p>Preparing room…</p></div>;
  // Server refused/closed the connection on purpose (4000-4006): replace the room with a clear screen.
  // Used before entering (boot.phase 'blocked') and when the socket is closed while inside the room.
  const blockedScreen = (code, message, canRetry) => {
    const info = closeInfo(code);
    const action = info?.action;
    return (
      <div className="center-page">
        <div className="card blocked">
          <div className="blocked-icon"><Icon name="alert" size={30} /></div>
          <h2>{info?.title || 'Connection closed'}</h2>
          <p className="blocked-msg">{message}</p>
          <span className="blocked-code">Code {code}</span>
          <div className="blocked-actions">
            {action === 'login' && <button onClick={signOut}>Log in again</button>}
            {action === 'retry' && canRetry && <button onClick={() => session?.reconnect()}>Reconnect</button>}
            {action !== 'login' && <button className={action === 'retry' && canRetry ? 'secondary' : ''} onClick={() => nav('/')}>Back to lobby</button>}
          </div>
        </div>
      </div>
    );
  };
  if (boot.phase === 'blocked') return blockedScreen(boot.code, boot.message, false);
  if (boot.phase === 'error') {
    return (
      <div className="center-page">
        <div className="card auth">
          <div className="banner error">{boot.message}</div>
          <button onClick={() => nav('/')}>Back to lobby</button>
        </div>
      </div>
    );
  }

  if (state.status === 'closed' && state.error && closeInfo(state.closeCode)) {
    return blockedScreen(state.closeCode, state.error, true);
  }

  const { isAdmin, canManage } = deriveRoles(state);
  // the room tab only exists for owner/admin: fall back to chat if the rights are lost (e.g. ownership transferred)
  const activeTab = tab === 'room' && !canManage ? 'chat' : tab;
  const rosterOf = (peerId) => state.roster.find((r) => r.peerId === peerId);
  const hasLocalVideo = !!state.localCamera?.getVideoTracks().length;
  const peers = Object.values(state.peers);

  // Every tile is described as { key, props } first, so the same tile can be drawn in the grid, in the
  // enlarged main area or in the thumbnail strip.
  const items = [];
  const addTile = (key, props) => items.push({ key, props });
  addTile('local', { stream: state.localCamera, label: `${auth.username} (You)`, roles: badgesFor(state, state.myPeerId), muted: true, mirror: true, off: !state.camOn || !hasLocalVideo });
  if (state.localScreen) addTile('local-screen', { stream: state.localScreen, label: 'Your screen', muted: true, screen: true });
  peers.forEach((p) => {
    const screenId = p.screen?.active ? p.screen.streamId : null;
    const camStreams = Object.entries(p.streams).filter(([id]) => id !== screenId);
    const camOff = p.camera?.active === false;
    const roles = badgesFor(state, p.peerId);
    const onManage = canManage && rosterOf(p.peerId) ? () => setManage(rosterOf(p.peerId)) : undefined;
    if (camStreams.length === 0) {
      addTile(`${p.peerId}:none`, { stream: null, label: p.username, roles, onManage, off: true, badge: p.connectionState });
    }
    camStreams.forEach(([id, st]) =>
      addTile(`${p.peerId}:${id}`, { stream: st, label: p.username, roles, onManage, off: camOff, badge: p.connectionState })
    );
    if (screenId && p.streams[screenId]) {
      addTile(`${p.peerId}:${screenId}`, { stream: p.streams[screenId], label: `${p.username} — screen`, screen: true });
    }
  });

  // If the enlarged tile disappeared (peer left, screen share stopped) we simply fall back to the grid.
  const focusedItem = items.find((it) => it.key === focusKey) || null;
  const toggleFocus = (key) => setFocusKey((k) => (k === key ? null : key));
  const renderTile = (it) => (
    <VideoTile key={it.key} {...it.props} sinkId={state.speakerId} focused={focusedItem?.key === it.key} onToggleFocus={() => toggleFocus(it.key)} />
  );

  return (
    <div className="room">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Icon name="video" size={20} /></span>{room?.name || roomId}</div>
        <span className={`pill ${state.status}`}>{STATUS_TEXT[state.status] || state.status}</span>
        <span className="muted">{peers.length + 1} / {state.settings?.maxPeers ?? 4} in room</span>
        {state.settings?.locked && <span className="pill closed" title="New participants cannot join"><Icon name="lock" size={12} /> Locked</span>}
        {state.settings?.chatEnabled === false && <span className="pill new">Chat off</span>}
        {state.settings?.screenShare === 'owner' && <span className="pill new">Screen: owner only</span>}
        <RoleBadges roles={badgesFor(state, state.myPeerId)} />
        <span className="grow" />
        <button className="secondary" onClick={() => navigator.clipboard?.writeText(location.href)}>Copy invite link</button>
      </header>

      {state.mediaError && (
        <div className="banner warn">
          <span><Icon name="videoOff" size={16} /> {state.mediaError} You can still join as a viewer.</span>
          <button onClick={() => session?.enableMedia()}>Retry camera</button>
        </div>
      )}
      {state.error && (
        <div className="banner error">
          <span><Icon name="alert" size={16} /> {state.error}</span>
          {(() => {
            // 4001/4002: only a new login helps. 4006: retrying is refused, so go back. Others: manual reconnect only.
            const action = closeInfo(state.closeCode)?.action;
            if (action === 'login') return <button onClick={signOut}>Log in again</button>;
            if (action === 'lobby') return <button onClick={() => nav('/')}>Back to lobby</button>;
            return <button onClick={() => session?.reconnect()}>Reconnect</button>;
          })()}
        </div>
      )}

      <div className="room-body">
        <main className={`stage${focusedItem ? ' has-focus' : ''}`}>
          {focusedItem ? (
            <div className="focus-layout">
              <div className="focus-main">{renderTile(focusedItem)}</div>
              {items.length > 1 && (
                <div className="strip">
                  {items.filter((it) => it !== focusedItem).map((it) => (
                    // clicking a thumbnail (but not one of its buttons) swaps it into the main area
                    <div key={it.key} className="strip-item" onClick={(e) => { if (!e.target.closest('button')) setFocusKey(it.key); }}>{renderTile(it)}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid">{items.map(renderTile)}</div>
          )}
        </main>
        {panelOpen && (
          <aside className="side">
            {activeTab === 'chat' && <ChatPanel state={state} session={session} />}
            {activeTab === 'people' && <PeoplePanel state={state} session={session} myName={auth.username} />}
            {activeTab === 'room' && canManage && <RoomSettingsPanel state={state} session={session} onEndRoom={() => setEndOpen(true)} />}
            {tab === 'files' && <FilesPanel state={state} session={session} />}
            {tab === 'stats' && <StatsPanel state={state} />}
            {tab === 'ice' && <IcePanel state={state} />}
          </aside>
        )}
      </div>

      <ControlsBar state={state} session={session} tab={activeTab} panelOpen={panelOpen} setTab={setTab} setPanelOpen={setPanelOpen} onLeave={leave} onEndRoom={() => setEndOpen(true)} onDevices={() => setDevicesOpen(true)} />

      {devicesOpen && <DeviceSettingsModal state={state} session={session} onClose={() => setDevicesOpen(false)} />}

      {manage && <PeerManageModal state={state} session={session} target={manage} isAdmin={isAdmin} onClose={() => setManage(null)} />}
      {endOpen && (
        <Modal title="End room for everyone?" onClose={() => setEndOpen(false)}
          footer={<><button className="secondary" onClick={() => setEndOpen(false)}>Cancel</button><button className="danger" onClick={() => { session?.closeRoom(endReason.trim() || undefined); setEndOpen(false); }}>End room</button></>}>
          <p className="muted">Everyone in the call is disconnected right away and the room closes.</p>
          <label>Message for participants (optional)<input value={endReason} onChange={(e) => setEndReason(e.target.value)} maxLength={200} placeholder="e.g. Meeting ended" autoFocus /></label>
        </Modal>
      )}

      {state.ended && (
        <div className="overlay">
          <div className="card auth">
            <h2>{state.ended.kind === 'kicked' ? (state.ended.banned ? 'You were removed and banned' : 'You were removed from the room') : 'The room was closed'}</h2>
            <p className="muted">{state.ended.kind === 'kicked'
              ? (state.ended.banned ? 'You cannot rejoin this room until it closes.' : 'The room owner or an administrator removed you from the call. You may rejoin unless the room is locked.')
              : `${state.ended.by ? `${state.ended.by} ended the meeting for everyone.` : 'The meeting was ended for everyone.'}`}</p>
            <div className="banner info"><span><b>Reason:</b> {state.ended.reason}</span></div>
            <button onClick={() => nav('/')}>Back to lobby</button>
          </div>
        </div>
      )}
      {state.joinError && !state.ended && (
        <div className="overlay">
          <div className="card auth">
            <h2>{JOIN_ERROR_TITLE[state.joinError.code] || 'Could not join the room'}</h2>
            <div className="banner error"><span><Icon name="alert" size={16} /> {state.joinError.message}</span></div>
            <p className="muted small">Code: <code>{state.joinError.code}</code></p>
            <div className="row">
              {state.joinError.code !== 'BANNED_FROM_ROOM' && <button onClick={() => session?.reconnect()}>Try again</button>}
              <button className="secondary" onClick={() => nav('/')}>Back to lobby</button>
            </div>
          </div>
        </div>
      )}

      <div className="notices">
        {state.notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`} onClick={() => session?.dismiss(n.id)}>{n.text}</div>
        ))}
      </div>
    </div>
  );
}
