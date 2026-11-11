import Icon from '../components/Icon';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { DEFAULT_ICE_SERVERS } from '../config';
import { useAuth } from '../context/AuthContext';
import { useSessionState } from '../hooks/useSessionState';
import { getForceRelay } from '../utils/prefs';
import { RoomSession } from '../webrtc/RoomSession';
import ChatPanel from '../components/ChatPanel';
import ControlsBar from '../components/ControlsBar';
import FilesPanel from '../components/FilesPanel';
import IcePanel from '../components/IcePanel';
import StatsPanel from '../components/StatsPanel';
import VideoTile from '../components/VideoTile';

const STATUS_TEXT = {
  idle: 'Starting…',
  media: 'Waiting for camera/microphone permission…',
  connecting: 'Connecting to signaling server…',
  joining: 'Joining room…',
  connected: 'Connected',
  closed: 'Disconnected'
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
  const state = useSessionState(session);

  useEffect(() => {
    let disposed = false;
    let s = null;
    (async () => {
      setBoot({ phase: 'loading', message: '' });
      setSession(null);
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

  const hasLocalVideo = !!state.localCamera?.getVideoTracks().length;
  const peers = Object.values(state.peers);

  const tiles = [
    <VideoTile key="local" stream={state.localCamera} label={`${auth.username} (You)`} muted mirror off={!state.camOn || !hasLocalVideo} />
  ];
  if (state.localScreen) tiles.push(<VideoTile key="local-screen" stream={state.localScreen} label="Your screen" muted screen />);
  peers.forEach((p) => {
    const screenId = p.screen?.active ? p.screen.streamId : null;
    const camStreams = Object.entries(p.streams).filter(([id]) => id !== screenId);
    const camOff = p.camera?.active === false;
    if (camStreams.length === 0) {
      tiles.push(<VideoTile key={`${p.peerId}:none`} stream={null} label={p.username} off badge={p.connectionState} />);
    }
    camStreams.forEach(([id, st]) =>
      tiles.push(<VideoTile key={`${p.peerId}:${id}`} stream={st} label={p.username} off={camOff} badge={p.connectionState} />)
    );
    if (screenId && p.streams[screenId]) {
      tiles.push(<VideoTile key={`${p.peerId}:${screenId}`} stream={p.streams[screenId]} label={`${p.username} — screen`} screen />);
    }
  });

  return (
    <div className="room">
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Icon name="video" size={20} /></span>{room?.name || roomId}</div>
        <span className={`pill ${state.status}`}>{STATUS_TEXT[state.status] || state.status}</span>
        <span className="muted">{peers.length + 1} / 4 in room</span>
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
          {state.closeCode === 4001 || state.closeCode === 4002
            ? <button onClick={signOut}>Log in again</button>
            : <button onClick={() => session?.reconnect()}>Reconnect</button>}
        </div>
      )}

      <div className="room-body">
        <main className="stage">
          <div className="grid">{tiles}</div>
        </main>
        {panelOpen && (
          <aside className="side">
            {tab === 'chat' && <ChatPanel state={state} session={session} />}
            {tab === 'files' && <FilesPanel state={state} session={session} />}
            {tab === 'stats' && <StatsPanel state={state} />}
            {tab === 'ice' && <IcePanel state={state} />}
          </aside>
        )}
      </div>

      <ControlsBar state={state} session={session} tab={tab} panelOpen={panelOpen} setTab={setTab} setPanelOpen={setPanelOpen} onLeave={leave} />

      <div className="notices">
        {state.notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`} onClick={() => session?.dismiss(n.id)}>{n.text}</div>
        ))}
      </div>
    </div>
  );
}
