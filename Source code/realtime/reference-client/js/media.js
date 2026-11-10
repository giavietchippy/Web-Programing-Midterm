'use strict';

export class MediaManager {
  constructor({ localVideo, log = () => {} }) {
    this.localVideo = localVideo;
    this.log = log;
    this.localStream = null;
    this.screenStream = null;
    this.listeners = new Map();
  }

  on(type, callback) {
    const callbacks = this.listeners.get(type) || new Set();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
    return () => callbacks.delete(callback);
  }

  emit(type, value) {
    for (const callback of this.listeners.get(type) || []) callback(value);
  }

  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera and microphone access requires HTTPS or localhost.');
    }
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    this.localVideo.srcObject = this.localStream;
    this.log('Camera and microphone started.');
    return this.localStream;
  }

  async startScreenShare() {
    if (this.screenStream) throw new Error('Screen sharing is already active.');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing is not available in this browser.');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const [track] = stream.getVideoTracks();
    if (!track) {
      for (const item of stream.getTracks()) item.stop();
      throw new Error('No screen video track was selected.');
    }

    this.screenStream = stream;
    track.addEventListener(
      'ended',
      () => {
        if (this.screenStream === stream) this.stopScreenShare();
      },
      { once: true },
    );
    this.log(`Screen sharing started (${stream.id}).`);
    this.emit('screen-started', { stream });
    return stream;
  }

  stopScreenShare() {
    const stream = this.screenStream;
    if (!stream) return;
    this.screenStream = null;
    const streamId = stream.id;
    for (const track of stream.getTracks()) {
      if (track.readyState !== 'ended') track.stop();
    }
    this.log(`Screen sharing stopped (${streamId}).`);
    this.emit('screen-stopped', { streamId });
  }

  stopAll() {
    this.stopScreenShare();
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    this.localVideo.srcObject = null;
  }
}
