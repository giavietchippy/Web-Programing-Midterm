// One RTCPeerConnection to one remote peer.
// Implements: perfect negotiation (websocket-contract.md), DataChannel chat/file transfer,
// ICE/connection logging and getStats() sampling.

const CHUNK = 16 * 1024;
const MAX_BUFFERED = 1024 * 1024;

const fmtCand = (c) => (typeof c === 'string' ? c : c?.candidate || '(end-of-candidates)');

export class PeerLink {
  /**
   * o = { peerId, myPeerId, initiator, iceServers, forceRelay, send(msg), log(cat,msg),
   *       onStream(stream), onState(patch), onChat({text,ts}), onFile(patch) }
   */
  constructor(o) {
    this.o = o;
    this.peerId = o.peerId;
    // contract: the peer whose peerId is lexicographically smaller is POLITE
    this.polite = o.myPeerId < o.peerId;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.queue = Promise.resolve();
    this.sendChain = Promise.resolve();
    this.senders = new Map(); // streamId -> RTCRtpSender[]
    this.pendingIce = []; // ICE may arrive before remote SDP via async signaling
    this.dc = null;
    this.incoming = null;
    this.prev = null;
    this.closed = false;

    this.pc = new RTCPeerConnection({
      iceServers: o.iceServers,
      iceTransportPolicy: o.forceRelay ? 'relay' : 'all'
    });
    o.log('init', `RTCPeerConnection created (polite=${this.polite}, initiator=${o.initiator}, policy=${o.forceRelay ? 'relay' : 'all'})`);
    this.wire();
  }

  wire() {
    const pc = this.pc;
    const o = this.o;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        o.log('ice', `local candidate: ${fmtCand(candidate)}`);
        o.send({ type: 'ice-candidate', to: this.peerId, candidate: candidate.toJSON ? candidate.toJSON() : candidate });
      } else {
        o.log('ice', 'candidate gathering finished (end-of-candidates)');
      }
    };
    pc.onicegatheringstatechange = () => o.log('gathering', pc.iceGatheringState);
    pc.onsignalingstatechange = () => o.log('signaling', pc.signalingState);
    pc.oniceconnectionstatechange = () => {
      o.log('ice-state', pc.iceConnectionState);
      o.onState({ iceState: pc.iceConnectionState });
    };
    pc.onconnectionstatechange = () => {
      o.log('conn-state', pc.connectionState);
      o.onState({ connectionState: pc.connectionState });
      if (pc.connectionState === 'connected') setTimeout(() => this.logSelectedPair(), 500);
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      o.log('track', `remote ${track.kind} track received (stream ${stream.id.slice(0, 8)}, muted=${track.muted})`);
      track.addEventListener('unmute', () => o.log('track', `remote ${track.kind} unmuted / frames available`));
      track.addEventListener('mute', () => o.log('track', `remote ${track.kind} muted / media paused`));
      o.onStream(stream);
    };
    pc.ondatachannel = ({ channel }) => this.setupChannel(channel);

    pc.onnegotiationneeded = async () => {
      // Contract: on the initial connection only the NEW JOINER offers.
      // Existing peers wait for the first remote offer before they may renegotiate.
      if (!o.initiator && !pc.remoteDescription) return;
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        // Never label an answer SDP as an offer during a renegotiation race.
        if (pc.localDescription?.type !== 'offer') return;
        o.send({ type: 'offer', to: this.peerId, sdp: pc.localDescription.sdp });
        o.log('sdp', 'sent offer');
      } catch (e) {
        o.log('error', `negotiation failed: ${e.message}`);
      } finally {
        this.makingOffer = false;
      }
    };
  }

  /** Called for the initiator (new joiner) after local tracks were added. */
  start() {
    this.setupChannel(this.pc.createDataChannel('data', { ordered: true }));
    this.ensureRecvKinds();
  }

  // make sure we can RECEIVE audio+video even if we have no camera/mic
  ensureRecvKinds() {
    ['audio', 'video'].forEach((kind) => {
      const has = this.pc.getTransceivers().some((t) => t.receiver?.track?.kind === kind);
      if (!has) this.pc.addTransceiver(kind, { direction: 'recvonly' });
    });
  }

  addLocalStream(stream) {
    const list = this.senders.get(stream.id) || [];
    stream.getTracks().forEach((t) => list.push(this.pc.addTrack(t, stream)));
    this.senders.set(stream.id, list);
  }

  addLocalTrack(track, stream) {
    const list = this.senders.get(stream.id) || [];
    list.push(this.pc.addTrack(track, stream));
    this.senders.set(stream.id, list);
  }

  /**
   * Swap the track a sender is sending WITHOUT renegotiation (used when the user picks another microphone).
   * Returns false when this link has no sender of that kind yet (caller then falls back to addLocalTrack).
   */
  async replaceTrack(stream, kind, newTrack) {
    const sender = (this.senders.get(stream.id) || []).find((s) => s.track?.kind === kind);
    if (!sender) return false;
    await sender.replaceTrack(newTrack);
    return true;
  }

  removeLocalStream(stream) {
    (this.senders.get(stream.id) || []).forEach((s) => {
      try { this.pc.removeTrack(s); } catch { /* connection closed */ }
    });
    this.senders.delete(stream.id);
  }

  // ---- signaling input (serialized so candidates never overtake the offer) ----
  handleSignal(msg) {
    this.queue = this.queue
      .then(() => this.process(msg))
      .catch((e) => this.o.log('error', `${msg.type}: ${e.message}`));
  }

  async process(msg) {
    if (this.closed) return;
    const pc = this.pc;
    const o = this.o;

    if (msg.type === 'ice-candidate') {
      if (!msg.candidate) return;
      // A candidate can be delivered before an offer/answer, even over an
      // ordered WebSocket: WebRTC's local ICE gathering runs asynchronously.
      if (!pc.remoteDescription) {
        this.pendingIce.push(msg.candidate);
        o.log('ice', 'queued early remote ICE candidate until SDP arrives');
        return;
      }
      try {
        await pc.addIceCandidate(msg.candidate);
        o.log('ice', `remote candidate: ${fmtCand(msg.candidate)}`);
      } catch (e) {
        if (!this.ignoreOffer) throw e;
      }
      return;
    }

    const description = { type: msg.type, sdp: msg.sdp };
    if (msg.type === 'offer') {
      const collision = this.makingOffer || pc.signalingState !== 'stable';
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) {
        o.log('sdp', 'offer collision: impolite peer ignores incoming offer');
        return;
      }
      if (collision) o.log('sdp', 'offer collision: polite peer rolls back and accepts');
      o.log('sdp', 'received offer');
      await pc.setRemoteDescription(description); // implicit rollback when needed
      await this.flushPendingIce();
      await pc.setLocalDescription();
      o.send({ type: 'answer', to: this.peerId, sdp: pc.localDescription.sdp });
      o.log('sdp', 'sent answer');
    } else if (msg.type === 'answer') {
      o.log('sdp', 'received answer');
      await pc.setRemoteDescription(description);
      await this.flushPendingIce();
    }
  }

  async flushPendingIce() {
    const candidates = this.pendingIce.splice(0);
    for (const candidate of candidates) {
      try {
        await this.pc.addIceCandidate(candidate);
        this.o.log('ice', `accepted buffered candidate: ${fmtCand(candidate)}`);
      } catch (e) {
        // The candidate may belong to a colliding/rolled-back offer.
        this.o.log('ice', `buffered candidate rejected: ${e.message}`);
      }
    }
  }

  // ---- DataChannel (P2P chat + file transfer) ----
  setupChannel(ch) {
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = 256 * 1024;
    this.dc = ch;
    ch.onopen = () => { this.o.log('datachannel', `open (${ch.label})`); this.o.onState({ dcOpen: true }); };
    ch.onclose = () => { this.o.log('datachannel', 'closed'); this.o.onState({ dcOpen: false }); };
    ch.onerror = () => this.o.log('datachannel', 'error');
    ch.onmessage = (e) => this.onDcMessage(e.data);
  }

  get dcOpen() { return !!this.dc && this.dc.readyState === 'open'; }

  sendChat(text) {
    if (!this.dcOpen) return false;
    this.dc.send(JSON.stringify({ t: 'chat', text, ts: new Date().toISOString() }));
    return true;
  }

  onDcMessage(data) {
    if (typeof data === 'string') {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      if (m.t === 'chat') {
        this.o.onChat({ text: String(m.text), ts: m.ts });
      } else if (m.t === 'file-meta') {
        this.incoming = { ...m, chunks: [], received: 0, lastEmit: 0 };
        this.o.onFile({ key: `${m.id}:${this.peerId}`, peerId: this.peerId, direction: 'in', name: m.name, size: m.size, progress: 0, status: 'receiving' });
      } else if (m.t === 'file-end' && this.incoming) {
        const inc = this.incoming;
        this.incoming = null;
        const blob = new Blob(inc.chunks, { type: inc.mime || 'application/octet-stream' });
        this.o.onFile({ key: `${inc.id}:${this.peerId}`, progress: 1, status: 'done', url: URL.createObjectURL(blob) });
      }
    } else if (this.incoming) {
      const inc = this.incoming;
      inc.chunks.push(data);
      inc.received += data.byteLength;
      const now = performance.now();
      if (now - inc.lastEmit > 150) {
        inc.lastEmit = now;
        this.o.onFile({ key: `${inc.id}:${this.peerId}`, progress: inc.size ? inc.received / inc.size : 0 });
      }
    }
  }

  sendFile(file) {
    // serialized: one file at a time per channel so chunks never interleave
    this.sendChain = this.sendChain.then(() => this.doSendFile(file));
    return this.sendChain;
  }

  async doSendFile(file) {
    const dc = this.dc;
    if (!this.dcOpen) throw new Error('DataChannel is not open');
    const id = Math.random().toString(36).slice(2, 10);
    const key = `${id}:${this.peerId}`;
    this.o.onFile({ key, peerId: this.peerId, direction: 'out', name: file.name, size: file.size, progress: 0, status: 'sending' });
    dc.send(JSON.stringify({ t: 'file-meta', id, name: file.name, size: file.size, mime: file.type }));
    let offset = 0;
    let lastEmit = 0;
    while (offset < file.size) {
      if (!this.dcOpen) {
        this.o.onFile({ key, status: 'failed' });
        throw new Error('DataChannel closed during transfer');
      }
      while (dc.bufferedAmount > MAX_BUFFERED) {
        // back-pressure: wait until the browser drained the send buffer
        await new Promise((r) => dc.addEventListener('bufferedamountlow', r, { once: true }));
      }
      const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
      dc.send(buf);
      offset += buf.byteLength;
      const now = performance.now();
      if (now - lastEmit > 150) {
        lastEmit = now;
        this.o.onFile({ key, progress: offset / file.size });
      }
    }
    dc.send(JSON.stringify({ t: 'file-end', id }));
    this.o.onFile({ key, progress: 1, status: 'done' });
  }

  // ---- getStats() ----
  async collect() {
    if (this.closed || this.pc.connectionState === 'closed') return null;
    const rep = await this.pc.getStats();
    const now = performance.now();
    const codecs = new Map();
    rep.forEach((r) => { if (r.type === 'codec') codecs.set(r.id, r); });

    let inBytes = 0, outBytes = 0, lost = 0, recv = 0;
    let jitter = null, fps = null, w = null, h = null, codec = null;
    let selectedId = null, dtls = null, srtp = null;

    rep.forEach((r) => {
      if (r.type === 'inbound-rtp') {
        inBytes += r.bytesReceived || 0;
        lost += r.packetsLost || 0;
        recv += r.packetsReceived || 0;
        if (typeof r.jitter === 'number') jitter = Math.max(jitter ?? 0, r.jitter * 1000);
        if (r.kind === 'video') {
          fps = r.framesPerSecond ?? fps;
          w = r.frameWidth ?? w;
          h = r.frameHeight ?? h;
          codec = codecs.get(r.codecId)?.mimeType || codec;
        }
      } else if (r.type === 'outbound-rtp') {
        outBytes += r.bytesSent || 0;
      } else if (r.type === 'transport') {
        if (r.selectedCandidatePairId) selectedId = r.selectedCandidatePairId;
        dtls = r.dtlsState || dtls;
        srtp = r.srtpCipher || srtp;
      }
    });

    let pair = selectedId ? rep.get(selectedId) : null;
    if (!pair) rep.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    const local = pair ? rep.get(pair.localCandidateId) : null;
    const remote = pair ? rep.get(pair.remoteCandidateId) : null;

    let inKbps = 0, outKbps = 0;
    if (this.prev) {
      const dt = (now - this.prev.t) / 1000;
      if (dt > 0) {
        inKbps = Math.max(0, ((inBytes - this.prev.inBytes) * 8) / 1000 / dt);
        outKbps = Math.max(0, ((outBytes - this.prev.outBytes) * 8) / 1000 / dt);
      }
    }
    this.prev = { t: now, inBytes, outBytes };

    return {
      ts: Date.now(),
      inKbps, outKbps,
      rttMs: pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
      lossPct: recv + lost > 0 ? (lost / (recv + lost)) * 100 : 0,
      jitterMs: jitter,
      fps,
      resolution: w && h ? `${w}x${h}` : null,
      codec,
      localType: local?.candidateType || null,
      remoteType: remote?.candidateType || null,
      protocol: local?.protocol || null,
      relay: local?.candidateType === 'relay' || remote?.candidateType === 'relay',
      dtls, srtp
    };
  }

  async logSelectedPair() {
    try {
      const s = await this.collect();
      if (s) this.o.log('pair', `selected pair: local=${s.localType}/${s.protocol} <-> remote=${s.remoteType} | ${s.relay ? 'TURN RELAY' : 'direct/STUN'} | DTLS=${s.dtls || '?'}`);
    } catch { /* ignore */ }
  }

  close() {
    this.closed = true;
    this.pendingIce.length = 0;
    try { this.dc?.close(); } catch { /* noop */ }
    this.pc.ontrack = this.pc.onicecandidate = this.pc.onnegotiationneeded = null;
    try { this.pc.close(); } catch { /* noop */ }
    this.o.log('close', 'peer connection closed');
  }
}
