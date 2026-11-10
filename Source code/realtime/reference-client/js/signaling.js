'use strict';

export class SignalingClient {
  constructor({ url, log = () => {} }) {
    this.url = url;
    this.log = log;
    this.socket = null;
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

  connect() {
    if (this.socket) return Promise.reject(new Error('Signaling socket already exists.'));
    this.socket = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      this.socket.addEventListener(
        'open',
        () => {
          this.log('WebSocket connected.');
          resolve();
        },
        { once: true },
      );
      this.socket.addEventListener(
        'error',
        () => {
          this.log('WebSocket connection error.');
          reject(new Error('Could not connect to the signaling server.'));
        },
        { once: true },
      );
      this.socket.addEventListener('message', (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          this.log(`Invalid JSON received: ${error.message}`);
          return;
        }
        this.log(`RECV ${JSON.stringify(message)}`);
        this.emit(message.type, message);
      });
      this.socket.addEventListener('close', (event) => {
        this.log(`WebSocket closed (${event.code}${event.reason ? `: ${event.reason}` : ''}).`);
        this.emit('close', event);
      });
    });
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.log(`SEND FAILED ${JSON.stringify(message)} (socket is not open)`);
      return false;
    }
    this.log(`SEND ${JSON.stringify(message)}`);
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(1000, 'Client left the room');
    }
  }
}
