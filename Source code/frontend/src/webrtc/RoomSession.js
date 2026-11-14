// Framework-independent controller for one meeting room:
// WebSocket signaling + local media + a PeerLink per remote peer.
// React reads it through useSyncExternalStore (see hooks/useSessionState.js),
// so a failure here can only produce a visible error message, never a blank page.
import { PeerLink } from './PeerLink';
import { buildWsUrl } from '../config';
import { closeInfo } from '../utils/closeCodes';
import { getMicId, setMicId, getSpeakerId, setSpeakerId } from '../utils/prefs';


// websocket-contract.md "Errors": friendly texts shown to the user (the raw server message goes to the ICE debug log).
export const ERROR_TEXT = {
  FORBIDDEN: 'You do not have permission to do that. Only the room owner or an administrator can.',
  ROOM_LOCKED: 'This room is locked by its owner, so new people cannot join right now.',
  ROOM_FULL: 'This room is full. Try again when someone leaves.',
  BANNED_FROM_ROOM: 'You were banned from this room, so you cannot rejoin until the room closes.',
  INVALID_SETTING: 'That room setting is not valid.',
  ROOM_CLOSED: 'This room has been closed.',
  ROOM_NOT_FOUND: 'This room does not exist in the platform database.',
  SERVICE_UNAVAILABLE: 'Platform is temporarily unavailable. Try joining again.',
  MAX_ROOMS_REACHED: 'The server has reached its maximum number of rooms. Try again later.',
  NOT_IN_ROOM: 'You are not in a room yet.',
  PEER_NOT_FOUND: 'That participant is no longer in the room.'
};
// Errors that mean "the join was refused" (the WebSocket stays open, but we are not in the room).
const JOIN_REFUSED = new Set(['ROOM_LOCKED', 'ROOM_FULL', 'BANNED_FROM_ROOM', 'MAX_ROOMS_REACHED', 'ROOM_CLOSED', 'ROOM_NOT_FOUND', 'SERVICE_UNAVAILABLE']);

export const initialState = {
  status: 'idle', // idle | media | connecting | joining | connected | closed
  error: null,
  closeCode: null,
  room: '',
  myPeerId: null,
  peers: {},
  localCamera: null,
  localScreen: null,
  micOn: false,
  camOn: false,
  mediaError: null,
  // audio device selection ('' = system default)
  devices: { mics: [], speakers: [] }, // [{ deviceId, label }]
  micId: '',
  speakerId: '',
  sinkSupported: false, // can this browser route playback to a chosen output device? (no on Safari)
  messages: [],
  transfers: [],
  iceLog: [],
  stats: {},
  notices: [],
  forceRelay: false,
  iceUrls: [],
  // room-owner / admin features (websocket-contract v1.1)
  myUserId: null,
  myRole: 'user', // site role from joined.you.role
  owner: null, // { peerId, userId } - userId is the stable identity of the owner
  settings: null, // { maxPeers, locked, chatEnabled, screenShare }
  roster: [], // [{ peerId, userId, username, role }] incl. me, from joined / room-state
  ended: null, // { kind: 'kicked' | 'closed', reason, banned?, by? } - the call is over, show why
  joinError: null // { code, title, message } - the server refused our join (locked / full / banned ...)
};

/** Who may manage the room: the owner (by userId) or a site admin. Hiding buttons is only convenience - the server enforces it. */
export function deriveRoles(state) {
  const me = state.roster.find((p) => p.peerId === state.myPeerId);
  const isAdmin = (me?.role || state.myRole) === 'admin';
  const isOwner = !!state.owner?.userId && state.owner.userId === state.myUserId;
  return { isAdmin, isOwner, canManage: isAdmin || isOwner };
}

/** Role badges for one participant: 'owner' (room role) and/or 'admin' (site role). */
export function badgesFor(state, peerId) {
  const r = state.roster.find((p) => p.peerId === peerId);
  const out = [];
  if (r && state.owner?.userId && r.userId === state.owner.userId) out.push('owner');
  if (r?.role === 'admin') out.push('admin');
  return out;
}

export function describeMediaError(e) {
  if (!e) return 'Could not access camera/microphone.';
  switch (e.name) {
    case 'NotAllowedError':
      return 'Camera/microphone permission was denied. Click the lock icon in the address bar, allow access, then press "Retry camera".';
    case 'NotFoundError':
      return 'No camera or microphone was found on this device.';
    case 'NotReadableError':
      return 'The camera/microphone is being used by another application or browser.';
    case 'OverconstrainedError':
      return 'The requested camera settings are not supported by this device.';
    case 'SecurityError':
      return 'Camera access is blocked. The page must be served over HTTPS or from http://localhost.';
    default:
      return `${e.name}: ${e.message}`;
  }
}

export class RoomSession {
  constructor(opts) {
    this.opts = opts; // { room, token, username, iceServers, forceRelay }
    this.state = {
      ...initialState,
      room: opts.room,
      forceRelay: !!opts.forceRelay,
      micId: getMicId(),
      speakerId: getSpeakerId(),
      sinkSupported: typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function',
      iceUrls: opts.iceServers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]))
    };
    this.listeners = new Set();
    this.links = new Map();
    this.pendingSignals = new Map(); // candidates arriving before an initial offer
    this.hist = new Map();
    this.ws = null;
    this.everOpened = false;
    this.closed = false;
    this.localCamera = null;
    this.localScreen = null;
    this.seq = 0;
    this.outq = [];
    this.pumping = false;
    this.statsTimer = null;
  }

  // ----- tiny store -----
  subscribe = (cb) => { this.listeners.add(cb); return () => this.listeners.delete(cb); };
  getState = () => this.state;
  set(patch) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  log(peerId, cat, msg) {
    const d = new Date();
    const t = d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    console.log(`[webrtc][${cat}]`, peerId, msg);
    this.set((s) => ({ iceLog: [...s.iceLog.slice(-299), { id: ++this.seq, t, peer: peerId, cat, msg }] }));
  }

  notify(kind, text, ttl = 7000) {
    const id = ++this.seq;
    this.set((s) => ({ notices: [...s.notices, { id, kind, text }].slice(-4) }));
    setTimeout(() => this.dismiss(id), ttl);
  }
  dismiss(id) { this.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })); }

  // ----- lifecycle -----
  async start() {
    this.set({ status: 'media' });
    await this.acquireMedia();
    if (this.closed) return;
    this.onDeviceChange = () => this.handleDeviceChange();
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    this.statsTimer = setInterval(() => this.tickStats(), 1000);
    this.connect();
  }

  async acquireMedia() {
    if (this.localCamera) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.set({ mediaError: 'This browser/context cannot use the camera. Open the app via HTTPS or http://localhost (plain http://<LAN-IP> is blocked by browsers).' });
      return;
    }
    // 'ideal' (not 'exact'): if the saved microphone is no longer plugged in we silently get the default one.
    const audio = this.state.micId ? { deviceId: { ideal: this.state.micId } } : true;
    const attempts = [
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio },
      { video: true, audio: false },
      { video: false, audio }
    ];
    let lastErr;
    for (const c of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(c);
        if (this.closed) { stream.getTracks().forEach((t) => t.stop()); return; }
        this.localCamera = stream;
        const mic = stream.getAudioTracks()[0];
        const gotId = mic?.getSettings?.().deviceId;
        this.set({
          localCamera: stream,
          camOn: stream.getVideoTracks().length > 0,
          micOn: !!mic,
          // the saved microphone was gone -> we got the default one, so show "System default"
          micId: this.state.micId && gotId && gotId !== this.state.micId ? '' : this.state.micId,
          mediaError: null
        });
        this.watchMic(mic);
        this.refreshDevices(); // labels only become available after permission was granted
        this.log('-', 'media', `local media ready: ${stream.getTracks().map((t) => t.kind).join('+')}`);
        return;
      } catch (e) {
        lastErr = e;
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break;
      }
    }
    this.set({ mediaError: describeMediaError(lastErr) });
    this.log('-', 'media', `getUserMedia failed: ${lastErr?.name}`);
  }

  /** "Retry camera" button / camera toggle when no camera yet */
  async enableMedia() {
    if (!this.localCamera) {
      await this.acquireMedia();
      if (this.closed || !this.localCamera) return;
      this.links.forEach((l) => l.addLocalStream(this.localCamera));
      this.announceMedia('camera');
      return;
    }
    // have audio only -> try to add video
    if (!this.localCamera.getVideoTracks().length) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = s.getVideoTracks()[0];
        this.localCamera.addTrack(track);
        this.links.forEach((l) => l.addLocalTrack(track, this.localCamera));
        this.set({ camOn: true, mediaError: null });
        this.announceMedia('camera');
      } catch (e) {
        this.set({ mediaError: describeMediaError(e) });
      }
    }
  }

  // ----- audio devices (microphone / speaker) -----
  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // 'default' / 'communications' are virtual aliases; the UI offers its own "System default" entry instead.
      const list = (kind, fallback) => all
        .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
      if (this.closed) return;
      this.set({ devices: { mics: list('audioinput', 'Microphone'), speakers: list('audiooutput', 'Speaker') } });
    } catch (e) {
      this.log('-', 'media', `enumerateDevices failed: ${e.name}`);
    }
  }

  async handleDeviceChange() {
    const before = this.state.devices;
    await this.refreshDevices();
    if (this.closed) return;
    const { devices, micId, speakerId } = this.state;
    const has = (arr, id) => arr.some((d) => d.deviceId === id);
    const added = [...devices.mics, ...devices.speakers].some((d) => !has([...before.mics, ...before.speakers], d.deviceId));
    // the device we were using was unplugged -> fall back to the system default
    if (micId && !has(devices.mics, micId)) {
      this.notify('warn', 'Your selected microphone was disconnected. Switched to the system default.');
      await this.setMic('');
      if (this.state.micId === micId) { setMicId(''); this.set({ micId: '' }); } // default also failed: at least stop showing the dead device
    } else if (speakerId && !has(devices.speakers, speakerId)) {
      this.notify('warn', 'Your selected speaker was disconnected. Switched to the system default.');
      await this.setSpeaker('');
      if (this.state.speakerId === speakerId) { setSpeakerId(''); this.set({ speakerId: '' }); }
    } else if (added) {
      this.notify('info', 'New audio device detected. Open "Audio" in the toolbar to use it.');
    }
  }

  // If the microphone vanishes while in use (USB unplugged) the track ends: recover with the system default.
  watchMic(track) {
    if (!track) return;
    track.onended = () => {
      if (this.closed || this.localCamera?.getAudioTracks()[0] !== track) return;
      this.notify('warn', 'Your microphone stopped (disconnected?). Trying the system default…');
      this.setMic('');
    };
  }

  /** Use another microphone. deviceId '' = system default. Keeps the mute state and does not renegotiate with peers. */
  async setMic(deviceId) {
    if (this.closed) return;
    if (!navigator.mediaDevices?.getUserMedia) return this.notify('error', 'This browser cannot access the microphone.');
    let newTrack;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
      newTrack = s.getAudioTracks()[0];
    } catch (e) {
      this.log('-', 'media', `switch microphone failed: ${e.name}`);
      return this.notify('error', `Could not use that microphone: ${describeMediaError(e)}`);
    }
    if (!newTrack) return;
    if (this.closed) { newTrack.stop(); return; }

    const stream = this.localCamera;
    const oldTrack = stream?.getAudioTracks()[0];
    newTrack.enabled = oldTrack ? oldTrack.enabled : true; // keep "muted" muted

    if (!stream) {
      // joined without any device: first microphone ever -> create the local stream and offer it to everyone
      this.localCamera = new MediaStream([newTrack]);
      this.links.forEach((l) => l.addLocalStream(this.localCamera));
      this.set({ localCamera: this.localCamera });
    } else if (!oldTrack) {
      // camera only so far: add an audio track (this one DOES renegotiate)
      stream.addTrack(newTrack);
      this.links.forEach((l) => l.addLocalTrack(newTrack, stream));
    } else {
      // normal case: swap the track inside the existing senders (same stream id, no new offer)
      await Promise.all([...this.links.values()].map(async (l) => {
        try {
          if (!(await l.replaceTrack(stream, 'audio', newTrack))) l.addLocalTrack(newTrack, stream);
        } catch (e) { this.log(l.peerId, 'media', `replaceTrack failed: ${e.message}`); }
      }));
      oldTrack.onended = null;
      stream.removeTrack(oldTrack);
      oldTrack.stop();
      stream.addTrack(newTrack);
    }

    this.watchMic(newTrack);
    setMicId(deviceId);
    this.set({ micId: deviceId, micOn: newTrack.enabled });
    this.announceMedia('microphone');
    this.refreshDevices();
    this.log('-', 'media', `microphone -> ${newTrack.label || deviceId || 'system default'}`);
  }

  /** Play remote audio through another output device. deviceId '' = system default. VideoTile applies it via setSinkId. */
  async setSpeaker(deviceId) {
    if (!this.state.sinkSupported) return;
    try {
      await new Audio().setSinkId(deviceId); // validate first so a bad id never breaks playback
    } catch (e) {
      this.log('-', 'media', `setSinkId failed: ${e.name}`);
      return this.notify('error', `Could not use that speaker: ${e.message || e.name}`);
    }
    setSpeakerId(deviceId);
    this.set({ speakerId: deviceId });
  }

  toggleCam() {
    const t = this.localCamera?.getVideoTracks()[0];
    if (!t) return this.enableMedia();
    t.enabled = !t.enabled;
    this.set({ camOn: t.enabled });
    this.announceMedia('camera');
  }

  toggleMic() {
    const t = this.localCamera?.getAudioTracks()[0];
    if (!t) return this.notify('warn', 'No microphone available.');
    t.enabled = !t.enabled;
    this.set({ micOn: t.enabled });
    this.announceMedia('microphone'); // lets admins see the mic state in the room detail page
  }

  async toggleScreen() {
    if (this.localScreen) return this.stopScreen();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return this.notify('error', 'Screen sharing is not supported in this browser/context.');
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (this.closed) { s.getTracks().forEach((t) => t.stop()); return; }
      this.localScreen = s; // separate MediaStream from the camera (contract)
      s.getVideoTracks()[0].onended = () => this.stopScreen();
      this.set({ localScreen: s });
      this.announceMedia('screen'); // media-state first, offer follows (negotiationneeded)
      this.links.forEach((l) => l.addLocalStream(s));
    } catch (e) {
      if (e.name !== 'NotAllowedError') this.notify('error', `Screen share failed: ${e.message}`);
    }
  }

  stopScreen() {
    const s = this.localScreen;
    if (!s) return;
    this.localScreen = null;
    this.links.forEach((l) => l.removeLocalStream(s));
    s.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.set({ localScreen: null });
    this.send({ type: 'media-state', kind: 'screen', active: false, streamId: s.id });
  }

  announceMedia(kind) {
    if (kind === 'camera') {
      const t = this.localCamera?.getVideoTracks()[0];
      this.send({ type: 'media-state', kind: 'camera', active: !!t && t.enabled, streamId: this.localCamera?.id || null });
    } else if (kind === 'microphone') {
      const t = this.localCamera?.getAudioTracks()[0];
      if (t) this.send({ type: 'media-state', kind: 'microphone', active: t.enabled, streamId: this.localCamera.id });
    } else if (this.localScreen) {
      this.send({ type: 'media-state', kind: 'screen', active: true, streamId: this.localScreen.id });
    }
  }
  announceAll() { this.announceMedia('camera'); this.announceMedia('microphone'); this.announceMedia('screen'); }

  // ----- signaling socket -----
  connect() {
    this.set({ status: 'connecting', error: null, closeCode: null, joinError: null });
    let ws;
    try {
      ws = new WebSocket(buildWsUrl(this.opts.token));
    } catch (e) {
      this.set({ status: 'closed', error: `Invalid WebSocket URL: ${e.message}` });
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.everOpened = true;
      this.log('-', 'ws', 'WebSocket open, sending join');
      this.set({ status: 'joining' });
      this.send({ type: 'join', room: this.opts.room });
    };
    ws.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(ev.data)); }
      catch (e) { this.log('-', 'error', `message handling failed: ${e.message}`); console.error(e); }
    };
    ws.onerror = () => this.log('-', 'ws', 'WebSocket error');
    ws.onclose = (ev) => this.onWsClose(ev, ws);
  }

  onWsClose(ev, ws) {
    if (this.closed || ws !== this.ws) return;
    const msg = closeInfo(ev.code)?.message || (this.everOpened
      ? `Signaling connection lost (code ${ev.code}).`
      : 'Cannot reach the signaling server (/ws). Check that the real-time server is running, the /ws proxy port is right, and the token is valid (a rejected upgrade also looks like this).');
    this.log('-', 'ws', `closed code=${ev.code}: ${msg}`);
    this.teardownLinks();
    this.set({ status: 'closed', error: msg, closeCode: ev.code, peers: {}, stats: {}, myPeerId: null });
  }

  reconnect() {
    if (this.closed) return;
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* noop */ } }
    this.teardownLinks();
    this.outq = [];
    this.set({ peers: {}, stats: {}, myPeerId: null });
    this.connect();
  }

  send(msg) {
    this.outq.push(msg);
    if (!this.pumping) { this.pumping = true; this.pump(); }
  }
  // paces outgoing frames (~25/s) to stay under the server limit of 30 messages/second
  pump() {
    const ws = this.ws;
    if (!this.outq.length || !ws || ws.readyState !== 1) { this.pumping = false; return; }
    ws.send(JSON.stringify(this.outq.shift()));
    setTimeout(() => this.pump(), 40);
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'joined': return this.onJoined(msg);
      case 'peer-joined':
        this.ensurePeer(msg.peerId, msg.username);
        this.log(msg.peerId, 'room', `${msg.username} joined`);
        this.announceAll(); // contract: re-announce media state for the newcomer
        return;
      case 'peer-left': return this.onPeerLeft(msg.peerId);
      case 'offer':
      case 'answer':
      case 'ice-candidate': return this.onSignal(msg);
      case 'chat':
        return this.pushMessage({ id: ++this.seq, transport: 'ws', from: msg.from, username: msg.username, text: msg.text, ts: msg.ts, mine: msg.from === this.state.myPeerId });
      case 'media-state': return this.onMediaState(msg);
      case 'room-state': return this.applyRoomState(msg);
      case 'kicked': return this.onKicked(msg);
      case 'force-mute': return this.onForceMute(msg);
      case 'room-closed': return this.onRoomClosed(msg);
      case 'announcement': return this.onAnnouncement(msg);
      case 'error': return this.onServerError(msg);
      default:
        this.log('-', 'ws', `unknown message type: ${msg.type}`);
    }
  }

  onJoined(msg) {
    const you = msg.you || { peerId: msg.peerId };
    this.set({ myPeerId: msg.peerId, myUserId: you.userId || null, myRole: you.role || 'user', status: 'connected', error: null, joinError: null });
    this.applyRoomState({ owner: msg.owner, settings: msg.settings, peers: [you, ...(msg.peers || [])] });
    this.log('-', 'room', `joined "${msg.room}" as ${msg.peerId}; ${msg.peers.length} peer(s) already here`);
    this.announceAll();
    for (const p of msg.peers) {
      this.ensurePeer(p.peerId, p.username);
      this.ensureLink(p.peerId, true); // the new joiner offers to every existing peer
    }
  }

  // ----- room owner / admin features -----
  applyRoomState(msg) {
    const roster = Array.isArray(msg.peers) ? msg.peers : this.state.roster;
    const names = {};
    roster.forEach((p) => { names[p.peerId] = p.username; });
    this.set((s) => ({
      owner: msg.owner !== undefined ? msg.owner : s.owner,
      settings: msg.settings ? { ...msg.settings } : s.settings,
      roster,
      myRole: roster.find((p) => p.peerId === s.myPeerId)?.role || s.myRole
    }));
    Object.entries(names).forEach(([id, name]) => { if (this.state.peers[id]) this.ensurePeer(id, name); });
  }

  userName(userId) { return this.state.roster.find((p) => p.userId === userId)?.username || 'An admin'; }

  onKicked(msg) {
    const reason = msg.reason || 'No reason given.';
    this.log('-', 'room', `kicked${msg.banned ? ' and banned' : ''}: ${reason}`);
    this.terminate({ kind: 'kicked', reason, banned: !!msg.banned });
  }

  onRoomClosed(msg) {
    const reason = msg.reason || 'The room was closed.';
    this.log('-', 'room', `room closed: ${reason}`);
    this.terminate({ kind: 'closed', reason, by: msg.by ? this.userName(msg.by) : null });
  }

  // force-mute is only a REQUEST (the server cannot touch our devices): we comply by turning our own local track off.
  onForceMute(msg) {
    const who = this.userName(msg.by);
    if (msg.kind === 'audio') {
      const t = this.localCamera?.getAudioTracks()[0];
      if (t) { t.enabled = false; this.set({ micOn: false }); this.announceMedia('microphone'); }
      this.notify('warn', `${who} muted your microphone. Press Unmute to speak again.`, 9000);
    } else if (msg.kind === 'video') {
      const t = this.localCamera?.getVideoTracks()[0];
      if (t) { t.enabled = false; this.set({ camOn: false }); this.announceMedia('camera'); }
      this.notify('warn', `${who} turned your camera off.`, 9000);
    } else if (msg.kind === 'screen') {
      this.stopScreen();
      this.notify('warn', `${who} stopped your screen sharing.`, 9000);
    }
  }

  onAnnouncement(msg) {
    this.log('-', 'room', `announcement: ${msg.text}`);
    this.notify('announce', `Announcement from ${this.userName(msg.from)}: ${msg.text}`, 15000);
  }

  onServerError(msg) {
    this.log('-', 'server-error', `${msg.code}: ${msg.message}`);
    const friendly = ERROR_TEXT[msg.code];
    if (JOIN_REFUSED.has(msg.code) && this.state.status === 'joining') return this.joinFail(msg.code, friendly || msg.message);
    if (msg.code === 'INVALID_SETTING') return this.notify('error', `${friendly} ${msg.message}`);
    // FORBIDDEN carries a specific server text ("Chat is disabled by the room owner."), so show that one.
    if (msg.code === 'FORBIDDEN') return this.notify('error', `Not allowed: ${msg.message || friendly}`);
    this.notify('error', friendly || `[${msg.code}] ${msg.message}`);
  }

  /** The server refused our join: stay on the page, keep the camera, explain why and offer "Try again". */
  joinFail(code, message) {
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(1000); } catch { /* noop */ } this.ws = null; }
    this.teardownLinks();
    this.outq = [];
    this.set({ status: 'closed', error: null, peers: {}, stats: {}, myPeerId: null, roster: [], joinError: { code, message } });
  }

  /** Leave the call for good (kicked / room closed) but keep the state so the page can explain what happened. */
  terminate(ended) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.statsTimer);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(1000); } catch { /* noop */ } }
    this.teardownLinks();
    this.localCamera?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.localScreen?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.set({ status: 'closed', ended, error: null, peers: {}, stats: {}, myPeerId: null, roster: [], localCamera: null, localScreen: null, camOn: false, micOn: false });
  }

  // Commands (the server re-checks permissions on every one of them)
  updateSettings(settings) { this.send({ type: 'update-settings', settings }); }
  kick(peerId, { ban = false, reason } = {}) { this.send({ type: 'kick', peerId, ban, ...(reason ? { reason } : {}) }); }
  mutePeer(peerId, kind) { this.send({ type: 'mute-peer', peerId, kind }); }
  muteAll(kind = 'audio') { this.send({ type: 'mute-all', kind }); }
  transferOwner(peerId) { this.send({ type: 'transfer-owner', peerId }); }
  closeRoom(reason) { this.send({ type: 'close-room', ...(reason ? { reason } : {}) }); }

  onPeerLeft(peerId) {
    const l = this.links.get(peerId);
    if (l) { l.close(); this.links.delete(peerId); }
    this.hist.delete(peerId);
    this.pendingSignals.delete(peerId);
    this.log(peerId, 'room', 'peer left (all its media state cleared)');
    this.set((s) => {
      const { [peerId]: _p, ...peers } = s.peers;
      const { [peerId]: _s, ...stats } = s.stats;
      return { peers, stats, roster: s.roster.filter((r) => r.peerId !== peerId) };
    });
  }

  onSignal(msg) {
    const from = msg.from;
    if (!from) return;
    this.ensurePeer(from);
    let link = this.links.get(from);
    if (!link) {
      // ICE can precede the first offer on the signaling socket. Previously
      // those candidates were silently dropped before PeerLink existed.
      if (msg.type === 'ice-candidate') {
        const pending = this.pendingSignals.get(from) || [];
        if (pending.length < 128) pending.push(msg);
        this.pendingSignals.set(from, pending);
        this.log(from, 'ice', 'queued remote candidate before initial offer');
        return;
      }
      if (msg.type !== 'offer') return;
      link = this.ensureLink(from, false);
      // Feed the offer first; PeerLink handles buffered early ICE afterward.
      link.handleSignal(msg);
      (this.pendingSignals.get(from) || []).forEach((candidate) => link.handleSignal(candidate));
      this.pendingSignals.delete(from);
      return;
    }
    link.handleSignal(msg);
  }

  onMediaState(msg) {
    const { from, kind, active, streamId } = msg;
    if (!from || !['camera', 'screen', 'microphone'].includes(kind)) return;
    this.ensurePeer(from);
    this.updatePeer(from, (p) => {
      const next = { ...p, [kind]: { active: !!active, streamId } };
      if (kind === 'screen' && !active && streamId && p.streams[streamId]) {
        const { [streamId]: _x, ...rest } = p.streams;
        next.streams = rest;
      }
      return next;
    });
  }

  // ----- peers / links -----
  ensurePeer(peerId, username) {
    const cur = this.state.peers[peerId];
    if (cur) {
      if (username && cur.username !== username) this.updatePeer(peerId, { username });
      return;
    }
    this.set((s) => ({
      peers: {
        ...s.peers,
        [peerId]: { peerId, username: username || `Peer ${peerId.slice(0, 4)}`, streams: {}, camera: null, screen: null, connectionState: 'new', iceState: 'new', dcOpen: false }
      }
    }));
  }

  updatePeer(id, patch) {
    this.set((s) => {
      const p = s.peers[id];
      if (!p) return {};
      return { peers: { ...s.peers, [id]: { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } } };
    });
  }

  peerName(id) { return this.state.peers[id]?.username || id; }

  ensureLink(peerId, initiator) {
    let l = this.links.get(peerId);
    if (l) return l;
    l = new PeerLink({
      peerId,
      myPeerId: this.state.myPeerId,
      initiator,
      iceServers: this.opts.iceServers,
      forceRelay: this.opts.forceRelay,
      send: (m) => this.send(m),
      log: (cat, msg) => this.log(peerId, cat, msg),
      onStream: (stream) => this.updatePeer(peerId, (p) => ({ streams: { ...p.streams, [stream.id]: stream } })),
      onState: (patch) => this.updatePeer(peerId, patch),
      onChat: ({ text, ts }) => this.pushMessage({ id: ++this.seq, transport: 'p2p', from: peerId, username: this.peerName(peerId), text, ts, mine: false }),
      onFile: (t) => this.upsertTransfer(t)
    });
    this.links.set(peerId, l);
    if (this.localCamera) l.addLocalStream(this.localCamera);
    if (this.localScreen) l.addLocalStream(this.localScreen);
    if (initiator) l.start();
    return l;
  }

  teardownLinks() {
    this.links.forEach((l) => l.close());
    this.links.clear();
    this.pendingSignals.clear();
    this.hist.clear();
  }

  // ----- chat & files -----
  pushMessage(m) { this.set((s) => ({ messages: [...s.messages, m].slice(-500) })); }

  loadHistory(items) {
    if (!Array.isArray(items) || !items.length) return;
    const msgs = items.map((i, n) => ({ id: i.id ? `h-${i.id}` : `h${n}`, transport: 'history', username: i.username || 'user', text: i.text, ts: i.ts || i.createdAt, mine: false }));
    this.set((s) => ({ messages: [...msgs, ...s.messages] }));
  }

  sendChat(text, transport) {
    const t = text.trim();
    if (!t) return;
    if (transport === 'p2p') {
      let n = 0;
      this.links.forEach((l) => { if (l.sendChat(t)) n++; });
      if (!n) return this.notify('warn', 'No open DataChannel yet - nobody received your P2P message.');
      this.pushMessage({ id: ++this.seq, transport: 'p2p', from: this.state.myPeerId, username: this.opts.username, text: t, ts: new Date().toISOString(), mine: true });
    } else {
      this.send({ type: 'chat', text: t }); // server broadcasts back to everyone incl. sender
    }
  }

  sendFile(file) {
    const MAX = 50 * 1024 * 1024;
    if (file.size > MAX) return this.notify('error', 'File too large (max 50 MB for this demo).');
    const open = [...this.links.values()].filter((l) => l.dcOpen);
    if (!open.length) return this.notify('warn', 'No open DataChannel yet - wait until a peer is connected.');
    open.forEach((l) => l.sendFile(file).catch((e) => this.notify('error', `File transfer failed: ${e.message}`)));
  }

  upsertTransfer(t) {
    this.set((s) => {
      const i = s.transfers.findIndex((x) => x.key === t.key);
      const arr = [...s.transfers];
      if (i >= 0) arr[i] = { ...arr[i], ...t }; else arr.push(t);
      return { transfers: arr };
    });
  }

  // ----- stats -----
  async tickStats() {
    if (!this.links.size) return;
    const patch = {};
    await Promise.all([...this.links].map(async ([id, l]) => {
      try {
        const s = await l.collect();
        if (!s) return;
        const h = (this.hist.get(id) || []).concat({ ts: s.ts, inKbps: s.inKbps, outKbps: s.outKbps, rttMs: s.rttMs }).slice(-60);
        this.hist.set(id, h);
        patch[id] = { latest: s, history: h };
      } catch { /* a link may close mid-sample */ }
    }));
    if (!this.closed) this.set((st) => ({ stats: { ...st.stats, ...patch } }));
  }

  // ----- leave -----
  close() {
    if (this.closed) return;
    try {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'leave', room: this.opts.room }));
    } catch { /* noop */ }
    this.closed = true;
    clearInterval(this.statsTimer);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    if (this.ws) { this.ws.onclose = null; try { this.ws.close(1000); } catch { /* noop */ } }
    this.teardownLinks();
    this.localCamera?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.localScreen?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.listeners.clear();
  }
}
