'use strict';

const ICE_CONFIGURATION = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export class PeerManager {
  constructor({ signaling, localStream, log = () => {}, onRemoteStream = () => {} }) {
    this.signaling = signaling;
    this.localStream = localStream;
    this.log = log;
    this.onRemoteStream = onRemoteStream;
    this.localPeerId = null;
    this.peers = new Map();
    this.mediaStates = new Map();
    this.pendingByPeer = new Map();
    this.localStreams = new Map([[localStream.id, localStream]]);
  }

  setLocalPeerId(peerId) {
    this.localPeerId = peerId;
  }

  addPeer(peerId, username = peerId, initiate = false) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection(ICE_CONFIGURATION);
    const peer = {
      peerId,
      username,
      pc,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      allowNegotiation: initiate,
      streams: new Map(),
      localSenders: new Map(),
    };
    peer.polite = Boolean(this.localPeerId && this.localPeerId < peerId);
    this.peers.set(peerId, peer);
    this.log(`Peer connection created for ${username} (${peerId}); polite=${peer.polite}.`);

    for (const stream of this.localStreams.values()) {
      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        const senders = peer.localSenders.get(stream.id) || [];
        senders.push(sender);
        peer.localSenders.set(stream.id, senders);
      }
    }

    pc.onnegotiationneeded = () => {
      if (peer.allowNegotiation) this.negotiate(peer);
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const description = candidate.toJSON();
      const type =
        description.candidate.match(/\btyp\s+(host|srflx|prflx|relay)\b/)?.[1] || 'unknown';
      this.log(`ICE candidate ${type} for ${peerId}.`);
      this.signaling.send({ type: 'ice-candidate', to: peerId, candidate: description });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      peer.streams.set(stream.id, stream);
      this.emitRemoteStream(peer, stream.id, stream);
    };
    pc.oniceconnectionstatechange = () => {
      this.log(`iceConnectionState ${peerId}: ${pc.iceConnectionState}`);
    };
    pc.onconnectionstatechange = () => {
      this.log(`connectionState ${peerId}: ${pc.connectionState}`);
    };
    pc.onsignalingstatechange = () => {
      this.log(`signalingState ${peerId}: ${pc.signalingState}`);
    };

    for (const candidate of this.pendingByPeer.get(peerId) || []) {
      (peer.pendingCandidates ||= []).push(candidate);
    }
    this.pendingByPeer.delete(peerId);
    return peer;
  }

  async negotiate(peer) {
    const { pc } = peer;
    if (peer.makingOffer || pc.signalingState !== 'stable') return;
    try {
      peer.makingOffer = true;
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      this.signaling.send({ type: 'offer', to: peer.peerId, sdp: pc.localDescription.sdp });
    } catch (error) {
      this.log(`Offer creation failed for ${peer.peerId}: ${error.message}`);
    } finally {
      peer.makingOffer = false;
    }
  }

  async handleOffer(message) {
    const peer = this.addPeer(message.from);
    const { pc } = peer;
    const offerCollision =
      message.type === 'offer' &&
      (peer.makingOffer || (pc.signalingState !== 'stable' && !peer.settingRemoteAnswer));
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) {
      this.log(`Ignored colliding offer from ${peer.peerId} (impolite peer).`);
      return;
    }

    if (offerCollision && peer.polite) {
      await pc.setLocalDescription({ type: 'rollback' });
      this.log(`Rolled back local offer for ${peer.peerId}; accepting their offer.`);
    }

    await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp });
    await this.addPendingCandidates(peer);
    // The existing peer answers the new joiner's offer; for renegotiation, either peer may offer.
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.send({ type: 'answer', to: peer.peerId, sdp: pc.localDescription.sdp });
    peer.allowNegotiation = true;
  }

  async handleAnswer(message) {
    const peer = this.peers.get(message.from);
    if (!peer) {
      this.log(`Ignored answer from unknown peer ${message.from}.`);
      return;
    }
    peer.settingRemoteAnswer = true;
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
    } finally {
      peer.settingRemoteAnswer = false;
    }
    await this.addPendingCandidates(peer);
  }

  async addPendingCandidates(peer) {
    const candidates = peer.pendingCandidates || [];
    peer.pendingCandidates = [];
    for (const candidate of candidates) {
      await peer.pc.addIceCandidate(candidate);
    }
  }

  async handleCandidate(message) {
    const peer = this.peers.get(message.from);
    if (!peer || !peer.pc.remoteDescription) {
      if (peer) (peer.pendingCandidates ||= []).push(message.candidate);
      else {
        const candidates = this.pendingByPeer.get(message.from) || [];
        candidates.push(message.candidate);
        this.pendingByPeer.set(message.from, candidates);
      }
      return;
    }
    if (peer.ignoreOffer) return;
    await peer.pc.addIceCandidate(message.candidate);
  }

  handleMediaState(message) {
    const byKind = this.mediaStates.get(message.from) || new Map();
    if (message.active) byKind.set(message.kind, message.streamId);
    else byKind.delete(message.kind);
    this.mediaStates.set(message.from, byKind);

    const peer = this.peers.get(message.from);
    const stream = peer?.streams.get(message.streamId);
    if (stream) {
      this.onRemoteStream({
        peerId: message.from,
        streamId: message.streamId,
        kind: message.kind,
        stream,
        active: message.active,
      });
    }
  }

  emitRemoteStream(peer, streamId, stream) {
    const state = this.mediaStates.get(peer.peerId);
    const kind = [...(state || [])].find(([, id]) => id === streamId)?.[0] || 'camera';
    this.onRemoteStream({ peerId: peer.peerId, streamId, kind, stream, active: true });
  }

  addLocalStream(stream) {
    this.localStreams.set(stream.id, stream);
    for (const peer of this.peers.values()) {
      const senders = peer.localSenders.get(stream.id) || [];
      for (const track of stream.getTracks()) senders.push(peer.pc.addTrack(track, stream));
      peer.localSenders.set(stream.id, senders);
    }
  }

  removeLocalStream(streamId) {
    const stream = this.localStreams.get(streamId);
    if (!stream) return;
    this.localStreams.delete(streamId);
    for (const peer of this.peers.values()) {
      for (const sender of peer.localSenders.get(streamId) || []) peer.pc.removeTrack(sender);
      peer.localSenders.delete(streamId);
    }
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.pc.close();
      this.peers.delete(peerId);
    }
    this.mediaStates.delete(peerId);
  }

  closeAll() {
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.mediaStates.clear();
    this.pendingByPeer.clear();
  }
}
