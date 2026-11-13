'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const path = require('node:path');
const WebSocket = require('ws');

const DEFAULT_CONFIG = {
  maxPeersPerRoom: 4,
  maxRooms: 100,
  maxConnectionsPerUser: 3,
  rateLimit: 30,
  defaultRoomSettings: {
    maxPeers: 4,
    locked: false,
    chatEnabled: true,
    screenShare: 'everyone',
  },
};
const MAX_MESSAGE_SIZE = 64 * 1024;
const MAX_HTTP_BODY_SIZE = 8 * 1024;
const MAX_TRANSPORT_PAYLOAD = 1024 * 1024;
const OWNER_GRACE_MS = 30_000;
const EMPTY_ROOM_TTL_MS = 30_000;
const REFERENCE_CLIENT_DIR = path.join(__dirname, 'reference-client');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const CLOSE_CODES = {
  INVALID_TOKEN: 4001,
  TOKEN_EXPIRED: 4002,
  RATE_LIMITED: 4003,
  BAD_MESSAGE: 4004,
  TOO_MANY_CONNECTIONS: 4005,
  USER_DENIED: 4006,
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUpgrade(socket, statusCode, code, message) {
  const statusText = statusCode === 403 ? 'Forbidden' : 'Unauthorized';
  const body = JSON.stringify({ code, message });
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
  socket.destroy();
}

function verifyToken(token, secret) {
  if (!token) return { error: 'INVALID_TOKEN', message: 'A JWT is required.' };

  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (
      typeof claims !== 'object' ||
      claims === null ||
      !isNonEmptyString(claims.userId) ||
      !isNonEmptyString(claims.username) ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp) ||
      (claims.role !== undefined && claims.role !== 'user' && claims.role !== 'admin')
    ) {
      return { error: 'INVALID_TOKEN', message: 'The JWT claims are invalid.' };
    }

    return {
      userId: claims.userId,
      username: claims.username,
      role: claims.role || 'user',
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { error: 'TOKEN_EXPIRED', message: 'The JWT has expired.' };
    }
    return { error: 'INVALID_TOKEN', message: 'The JWT is invalid.' };
  }
}

function isAllowedDevelopmentOrigin(origin) {
  return /^http:\/\/localhost(?::\d+)?$/.test(origin);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function readRequestBody(request, maxSize = MAX_HTTP_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    request.on('error', reject);
  });
}

function validateRoomSettings(input, current, maxPeersPerRoom) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'INVALID_SETTING', message: 'settings must be an object.' };
  }
  const allowed = new Set(['maxPeers', 'locked', 'chatEnabled', 'screenShare']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      return { error: 'INVALID_SETTING', message: `Unknown setting: ${key}.` };
    }
  }

  const next = { ...current };
  if (Object.hasOwn(input, 'maxPeers')) {
    if (
      !Number.isInteger(input.maxPeers) ||
      input.maxPeers < 1 ||
      input.maxPeers > maxPeersPerRoom
    ) {
      return {
        error: 'INVALID_SETTING',
        message: `maxPeers must be an integer from 1 to ${maxPeersPerRoom}.`,
      };
    }
    next.maxPeers = input.maxPeers;
  }
  for (const key of ['locked', 'chatEnabled']) {
    if (Object.hasOwn(input, key)) {
      if (typeof input[key] !== 'boolean') {
        return { error: 'INVALID_SETTING', message: `${key} must be a boolean.` };
      }
      next[key] = input[key];
    }
  }
  if (Object.hasOwn(input, 'screenShare')) {
    if (input.screenShare !== 'everyone' && input.screenShare !== 'owner') {
      return {
        error: 'INVALID_SETTING',
        message: 'screenShare must be "everyone" or "owner".',
      };
    }
    next.screenShare = input.screenShare;
  }
  return { settings: next };
}

function createSignalingServer({
  port = Number(process.env.PORT || 8080),
  secret = process.env.JWT_SECRET,
  production = process.env.NODE_ENV === 'production',
} = {}) {
  if (!isNonEmptyString(secret)) {
    throw new Error('JWT_SECRET must be set before starting the signaling server.');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const config = structuredClone(DEFAULT_CONFIG);
  const rooms = new Map();
  const connectionsByUser = new Map();
  const errorsByCode = new Map();
  const messageTimes = [];
  const httpRateLimits = new Map();
  const deniedUsers = new Map();
  const auditEntries = [];
  const adminFeeds = new Set();
  const dataDirectory = path.join(__dirname, 'data');
  const configPath = path.join(dataDirectory, 'config.json');
  const auditPath = path.join(dataDirectory, 'audit.jsonl');
  let auditWriteChain = Promise.resolve();
  let dataLoaded = false;
  const startedAt = Date.now();
  let peakConnections = 0;
  let statsTimer;

  const server = http.createServer((request, response) => {
    handleHttpRequest(request, response).catch((error) => {
      console.error(`HTTP handler error: ${error.message}`);
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'INTERNAL_ERROR', message: 'Internal server error.' });
      } else {
        response.destroy();
      }
    });
  });
  const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_TRANSPORT_PAYLOAD });
  const rejectedWss = new WebSocket.Server({
    noServer: true,
    clientTracking: false,
    maxPayload: MAX_TRANSPORT_PAYLOAD,
  });
  const rejectedSockets = new Set();

  function recordAudit(
    actor,
    action,
    room = null,
    target = null,
    details = {},
    result = 'success',
  ) {
    const entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: {
        userId: actor?.userId || null,
        username: actor?.username || 'system',
        role: actor?.role || 'system',
      },
      action,
      room,
      target,
      details,
      result,
    };
    auditEntries.push(entry);
    if (auditEntries.length > 5000) auditEntries.shift();
    publishAdmin({ type: 'audit', entry });
    auditWriteChain = auditWriteChain
      .then(async () => {
        await fs.mkdir(dataDirectory, { recursive: true });
        await fs.appendFile(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
      })
      .catch((error) => {
        console.error(`Could not persist audit entry ${entry.id}: ${error.message}`);
      });
    return entry;
  }

  function publishAdmin(message) {
    for (const ws of adminFeeds) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }
  }

  function apiError(response, status, code, message) {
    errorsByCode.set(code, (errorsByCode.get(code) || 0) + 1);
    sendJson(response, status, { error: code, message });
  }

  function validateGlobalConfig(input, current) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { error: 'INVALID_SETTING', message: 'Config must be a JSON object.' };
    }
    const allowed = new Set([
      'maxPeersPerRoom',
      'maxRooms',
      'maxConnectionsPerUser',
      'rateLimit',
      'defaultRoomSettings',
    ]);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        return { error: 'INVALID_SETTING', message: `Unknown config field: ${key}.` };
      }
    }
    const next = structuredClone(current);
    const ranges = {
      maxPeersPerRoom: [1, 100],
      maxRooms: [1, 10_000],
      maxConnectionsPerUser: [1, 100],
      rateLimit: [1, 10_000],
    };
    for (const [key, [min, max]] of Object.entries(ranges)) {
      if (Object.hasOwn(input, key)) {
        if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) {
          return {
            error: 'INVALID_SETTING',
            message: `${key} must be an integer from ${min} to ${max}.`,
          };
        }
        next[key] = input[key];
      }
    }
    if (next.maxPeersPerRoom !== current.maxPeersPerRoom && !input.defaultRoomSettings) {
      next.defaultRoomSettings.maxPeers = Math.min(
        next.defaultRoomSettings.maxPeers,
        next.maxPeersPerRoom,
      );
    }
    if (Object.hasOwn(input, 'defaultRoomSettings')) {
      const settings = validateRoomSettings(
        input.defaultRoomSettings,
        next.defaultRoomSettings,
        next.maxPeersPerRoom,
      );
      if (settings.error) return settings;
      next.defaultRoomSettings = settings.settings;
    }
    if (next.defaultRoomSettings.maxPeers > next.maxPeersPerRoom) {
      return {
        error: 'INVALID_SETTING',
        message: 'defaultRoomSettings.maxPeers cannot exceed maxPeersPerRoom.',
      };
    }
    return { config: next };
  }

  async function persistConfig(nextConfig) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, configPath);
  }

  async function loadRuntimeData() {
    if (dataLoaded) return;
    await fs.mkdir(dataDirectory, { recursive: true });
    try {
      const stored = JSON.parse(await fs.readFile(configPath, 'utf8'));
      const result = validateGlobalConfig(stored, config);
      if (result.error) throw new Error(`Invalid persisted config: ${result.message}`);
      Object.assign(config, result.config);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      const content = await fs.readFile(auditPath, 'utf8');
      const rows = content.split(/\r?\n/).filter(Boolean);
      for (const row of rows.slice(-5000)) auditEntries.push(JSON.parse(row));
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(`Could not load persisted audit log: ${error.message}`);
    }
    dataLoaded = true;
  }

  function takeHttpRateLimit(userId) {
    const now = Date.now();
    let entry = httpRateLimits.get(userId);
    if (!entry || now - entry.startedAt >= 1000) {
      entry = { startedAt: now, count: 0 };
      httpRateLimits.set(userId, entry);
    }
    entry.count += 1;
    return entry.count <= config.rateLimit;
  }

  function isOwner(room, ws) {
    return room.ownerUserId === ws.userId;
  }

  function canManage(room, ws) {
    return ws.role === 'admin' || isOwner(room, ws);
  }

  function ownerPeer(room) {
    const activeOwner = [...room.peers.values()].find((peer) => peer.userId === room.ownerUserId);
    return {
      peerId: activeOwner?.peerId || room.ownerPeerId || null,
      userId: room.ownerUserId,
    };
  }

  function peerRecord(ws) {
    return {
      peerId: ws.peerId,
      userId: ws.userId,
      username: ws.username,
      role: ws.role,
    };
  }

  function roomState(room) {
    return {
      type: 'room-state',
      room: room.id,
      owner: ownerPeer(room),
      settings: { ...room.settings },
      peers: [...room.peers.values()].map(peerRecord),
    };
  }

  function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function sendError(ws, code, message, closeCode) {
    errorsByCode.set(code, (errorsByCode.get(code) || 0) + 1);
    if (code === 'FORBIDDEN' && ws?.userId) {
      recordAudit(
        ws,
        `forbidden:${ws.lastAction || 'websocket'}`,
        ws.room,
        ws.lastMessage?.peerId || ws.lastMessage?.to || null,
        { message },
        'denied',
      );
    }
    if (closeCode) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'error', code, message }), (error) => {
        if (error) ws.terminate();
        else ws.close(closeCode, code);
      });
      return;
    }
    send(ws, { type: 'error', code, message });
  }

  function closeRejectedWebSocket(request, socket, head, code, message, closeCode, identity) {
    rejectedWss.handleUpgrade(request, socket, head, (ws) => {
      if (identity) {
        ws.userId = identity.userId;
        ws.username = identity.username;
        ws.role = identity.role;
      }
      rejectedSockets.add(ws);
      ws.once('close', () => rejectedSockets.delete(ws));
      sendError(ws, code, message, closeCode);
    });
  }

  function broadcastRoom(room, message, except) {
    for (const peer of room.peers.values()) {
      if (peer !== except) send(peer, message);
    }
  }

  function broadcastRoomState(room) {
    broadcastRoom(room, roomState(room));
  }

  function cancelTimer(timer) {
    if (timer) clearTimeout(timer);
  }

  function clearRoom(room) {
    cancelTimer(room.ownerGraceTimer);
    cancelTimer(room.emptyTimer);
    rooms.delete(room.id);
  }

  function scheduleEmptyDelete(room) {
    if (room.peers.size !== 0) return;
    if (room.emptyTimer) return;
    room.emptyTimer = setTimeout(() => {
      if (rooms.get(room.id) === room && room.peers.size === 0) clearRoom(room);
    }, EMPTY_ROOM_TTL_MS);
    room.emptyTimer.unref?.();
  }

  function transferOwner(room, peer, actor = { username: 'system', role: 'system' }) {
    cancelTimer(room.ownerGraceTimer);
    room.ownerGraceTimer = null;
    room.ownerUserId = peer.userId;
    room.ownerPeerId = peer.peerId;
    broadcastRoomState(room);
    recordAudit(actor, 'owner-transfer', room.id, peer.userId, { peerId: peer.peerId });
    publishAdmin({ type: 'room-updated', room: roomSummary(room) });
  }

  function scheduleOwnerTransfer(room) {
    cancelTimer(room.ownerGraceTimer);
    room.ownerGraceTimer = setTimeout(() => {
      if (rooms.get(room.id) !== room) return;
      const ownerReconnected = [...room.peers.values()].find(
        (peer) => peer.userId === room.ownerUserId,
      );
      if (ownerReconnected) {
        room.ownerPeerId = ownerReconnected.peerId;
        broadcastRoomState(room);
        return;
      }
      const successor = [...room.peers.values()].sort(
        (left, right) => left.joinedAt - right.joinedAt,
      )[0];
      if (successor) transferOwner(room, successor);
      else scheduleEmptyDelete(room);
    }, OWNER_GRACE_MS);
    room.ownerGraceTimer.unref?.();
  }

  function createRoom(id, owner, settings) {
    const room = {
      id,
      ownerUserId: owner.role === 'admin' ? null : owner.userId,
      ownerPeerId: owner.role === 'admin' ? null : owner.peerId,
      settings,
      peers: new Map(),
      bannedUsers: new Set(),
      createdAt: new Date().toISOString(),
      ownerGraceTimer: null,
      emptyTimer: null,
    };
    rooms.set(id, room);
    publishAdmin({ type: 'room-created', room: roomSummary(room) });
    return room;
  }

  function removePeerFromRoom(room, peer, { kicked = false, reason = '', banned = false } = {}) {
    if (!room.peers.has(peer.peerId)) return;
    if (kicked) send(peer, { type: 'kicked', reason, banned });
    for (const [kind, state] of peer.mediaStates || []) {
      broadcastRoom(
        room,
        {
          type: 'media-state',
          from: peer.peerId,
          kind,
          active: false,
          streamId: state.streamId,
        },
        peer,
      );
    }
    room.peers.delete(peer.peerId);
    peer.room = null;
    peer.joinedAt = null;
    peer.mediaStates.clear();
    if (room.ownerUserId === peer.userId) {
      const anotherOwnerPeer = [...room.peers.values()].find(
        (member) => member.userId === room.ownerUserId,
      );
      if (anotherOwnerPeer) {
        room.ownerPeerId = anotherOwnerPeer.peerId;
        cancelTimer(room.ownerGraceTimer);
        room.ownerGraceTimer = null;
      } else {
        room.ownerPeerId = null;
        scheduleOwnerTransfer(room);
      }
    }
    broadcastRoom(room, { type: 'peer-left', peerId: peer.peerId });
    publishAdmin({ type: 'peer-left', room: room.id, peerId: peer.peerId });
    broadcastRoomState(room);
    scheduleEmptyDelete(room);
  }

  function leaveRoom(ws) {
    const room = ws.room && rooms.get(ws.room);
    if (room) removePeerFromRoom(room, ws);
    else ws.room = null;
  }

  function closeRoom(room, reason, actor) {
    const by = actor?.userId || actor;
    const message = { type: 'room-closed', reason, by };
    for (const peer of room.peers.values()) {
      send(peer, message);
      peer.room = null;
      peer.joinedAt = null;
      peer.mediaStates.clear();
    }
    clearRoom(room);
    recordAudit(
      typeof actor === 'object' ? actor : { userId: actor },
      'room-close',
      room.id,
      null,
      {
        reason,
      },
    );
    publishAdmin({ type: 'room-closed', room: room.id, reason, by });
  }

  function kickPeer(room, target, reason, banned, actor) {
    if (banned) room.bannedUsers.add(target.userId);
    recordAudit(actor, banned ? 'ban' : 'kick', room.id, target.userId, {
      peerId: target.peerId,
      reason,
    });
    removePeerFromRoom(room, target, { kicked: true, reason, banned });
  }

  function validateSettings(room, settings) {
    return validateRoomSettings(settings, room.settings, config.maxPeersPerRoom);
  }

  function joinRoom(ws, message) {
    if (!isNonEmptyString(message.room)) {
      sendError(
        ws,
        'BAD_MESSAGE',
        'join.room must be a non-empty string.',
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }
    const roomId = message.room;
    let room = rooms.get(roomId);
    let createdRoom = false;

    if (!room) {
      if (rooms.size >= config.maxRooms) {
        sendError(ws, 'MAX_ROOMS_REACHED', 'The server has reached its room limit.');
        return;
      }
      let settings = { ...config.defaultRoomSettings };
      if (message.settings !== undefined) {
        const result = validateRoomSettings(message.settings, settings, config.maxPeersPerRoom);
        if (result.error) {
          sendError(ws, result.error, result.message);
          return;
        }
        settings = result.settings;
      }
      room = createRoom(roomId, ws, settings);
      createdRoom = true;
    } else if (message.settings !== undefined) {
      sendError(ws, 'INVALID_SETTING', 'settings may only be supplied when creating a room.');
      return;
    }

    if (room.bannedUsers.has(ws.userId)) {
      sendError(ws, 'BANNED_FROM_ROOM', 'You are banned from this room.');
      return;
    }
    if (room.settings.locked && !createdRoom && ws.role !== 'admin' && !isOwner(room, ws)) {
      sendError(ws, 'ROOM_LOCKED', 'This room is locked.');
      return;
    }
    if (
      room.peers.size >= room.settings.maxPeers &&
      !room.peers.has(ws.peerId) &&
      ws.role !== 'admin'
    ) {
      sendError(ws, 'ROOM_FULL', 'The room has reached its peer limit.');
      return;
    }

    const existing = room.peers.get(ws.peerId);
    if (existing) {
      sendJoined(ws, room);
      return;
    }
    if (ws.room) leaveRoom(ws);

    cancelTimer(room.emptyTimer);
    room.emptyTimer = null;
    if (isOwner(room, ws)) {
      cancelTimer(room.ownerGraceTimer);
      room.ownerGraceTimer = null;
      room.ownerPeerId = ws.peerId;
    }

    const peersBeforeJoin = [...room.peers.values()];
    ws.room = room.id;
    ws.joinedAt = Date.now();
    room.peers.set(ws.peerId, ws);
    sendJoined(ws, room, peersBeforeJoin);
    for (const peer of peersBeforeJoin) {
      send(peer, { type: 'peer-joined', peerId: ws.peerId, username: ws.username });
    }
    publishAdmin({ type: 'peer-joined', room: room.id, peer: peerRecord(ws) });
    broadcastRoomState(room);
  }

  function sendJoined(ws, room, peers = [...room.peers.values()].filter((peer) => peer !== ws)) {
    send(ws, {
      type: 'joined',
      peerId: ws.peerId,
      room: room.id,
      you: {
        peerId: ws.peerId,
        userId: ws.userId,
        username: ws.username,
        role: ws.role,
      },
      owner: ownerPeer(room),
      settings: { ...room.settings },
      peers: peers.map((peer) => ({
        peerId: peer.peerId,
        userId: peer.userId,
        username: peer.username,
        role: peer.role,
      })),
    });
  }

  function handleRelay(ws, message, type) {
    const room = ws.room && rooms.get(ws.room);
    if (!room) {
      sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending this message.');
      return;
    }
    if (!isNonEmptyString(message.to)) {
      sendError(
        ws,
        'BAD_MESSAGE',
        `${type}.to must be a non-empty string.`,
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }
    if (type !== 'ice-candidate' && typeof message.sdp !== 'string') {
      sendError(ws, 'BAD_MESSAGE', `${type}.sdp must be a string.`, CLOSE_CODES.BAD_MESSAGE);
      return;
    }
    if (
      type === 'ice-candidate' &&
      (typeof message.candidate !== 'object' ||
        message.candidate === null ||
        Array.isArray(message.candidate))
    ) {
      sendError(
        ws,
        'BAD_MESSAGE',
        'ice-candidate.candidate must be an object.',
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }
    const target = room.peers.get(message.to);
    if (!target || target.readyState !== WebSocket.OPEN) {
      sendError(ws, 'PEER_NOT_FOUND', 'The target peer is not in your room.');
      return;
    }
    const forwarded = { type, from: ws.peerId, to: message.to };
    if (type === 'ice-candidate') forwarded.candidate = message.candidate;
    else forwarded.sdp = message.sdp;
    send(target, forwarded);
  }

  function requireManager(ws, room) {
    if (canManage(room, ws)) return true;
    sendError(ws, 'FORBIDDEN', 'Only the room owner or an admin may perform this action.');
    return false;
  }

  function handleRoomAction(ws, message) {
    const room = ws.room && rooms.get(ws.room);
    if (!room) {
      sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending this message.');
      return;
    }
    switch (message.type) {
      case 'update-settings': {
        if (!requireManager(ws, room)) return;
        const result = validateSettings(room, message.settings);
        if (result.error) {
          sendError(ws, result.error, result.message);
          return;
        }
        room.settings = result.settings;
        broadcastRoomState(room);
        recordAudit(ws, 'settings-change', room.id, null, { settings: room.settings });
        publishAdmin({ type: 'room-updated', room: roomSummary(room) });
        break;
      }
      case 'kick': {
        if (!requireManager(ws, room)) return;
        if (!isNonEmptyString(message.peerId)) {
          sendError(
            ws,
            'BAD_MESSAGE',
            'kick.peerId must be a non-empty string.',
            CLOSE_CODES.BAD_MESSAGE,
          );
          return;
        }
        const target = room.peers.get(message.peerId);
        if (!target) {
          sendError(ws, 'PEER_NOT_FOUND', 'The target peer is not in your room.');
          return;
        }
        const ban = message.ban === undefined ? false : message.ban;
        if (
          typeof ban !== 'boolean' ||
          (message.reason !== undefined && typeof message.reason !== 'string')
        ) {
          sendError(
            ws,
            'BAD_MESSAGE',
            'kick.ban must be boolean and reason must be a string.',
            CLOSE_CODES.BAD_MESSAGE,
          );
          return;
        }
        if (isOwner(room, ws) && (target.userId === ws.userId || target.role === 'admin')) {
          sendError(ws, 'FORBIDDEN', 'Owners cannot kick themselves or an admin.');
          return;
        }
        kickPeer(room, target, message.reason || 'Removed by room owner.', ban, ws);
        break;
      }
      case 'mute-peer':
      case 'mute-all': {
        if (!requireManager(ws, room)) return;
        if (!['audio', 'video', 'screen'].includes(message.kind)) {
          sendError(ws, 'BAD_MESSAGE', `${message.type}.kind must be audio, video, or screen.`);
          return;
        }
        let targets;
        if (message.type === 'mute-all') {
          targets = [...room.peers.values()].filter((peer) => peer !== ws);
        } else {
          if (!isNonEmptyString(message.peerId)) {
            sendError(ws, 'BAD_MESSAGE', 'mute-peer.peerId must be a non-empty string.');
            return;
          }
          const target = room.peers.get(message.peerId);
          if (!target) {
            sendError(ws, 'PEER_NOT_FOUND', 'The target peer is not in your room.');
            return;
          }
          targets = [target];
        }
        for (const target of targets) {
          send(target, { type: 'force-mute', kind: message.kind, by: ws.userId });
        }
        recordAudit(ws, message.type, room.id, message.peerId || null, {
          kind: message.kind,
          targets: targets.map((target) => target.peerId),
        });
        break;
      }
      case 'transfer-owner': {
        if (!requireManager(ws, room)) return;
        const target = room.peers.get(message.peerId);
        if (!target) {
          sendError(ws, 'PEER_NOT_FOUND', 'The new owner must be in the room.');
          return;
        }
        transferOwner(room, target, ws);
        break;
      }
      case 'close-room':
        if (!requireManager(ws, room)) return;
        if (message.reason !== undefined && typeof message.reason !== 'string') {
          sendError(
            ws,
            'BAD_MESSAGE',
            'close-room.reason must be a string.',
            CLOSE_CODES.BAD_MESSAGE,
          );
          return;
        }
        closeRoom(room, message.reason || 'Room closed.', ws);
        break;
      default:
        sendError(ws, 'BAD_MESSAGE', 'Unknown room action.', CLOSE_CODES.BAD_MESSAGE);
    }
  }

  function handleMessage(ws, data, isBinary) {
    const now = Date.now();
    if (now - ws.rateWindowStartedAt >= 1000) {
      ws.rateWindowStartedAt = now;
      ws.rateMessageCount = 0;
    }
    ws.rateMessageCount += 1;
    ws.rateTimes = ws.rateTimes.filter((time) => time > now - 1000);
    ws.rateTimes.push(now);
    while (messageTimes.length && messageTimes[0] <= now - 1000) messageTimes.shift();
    messageTimes.push(now);
    if (ws.rateMessageCount > ws.rateLimit) {
      sendError(
        ws,
        'RATE_LIMITED',
        'The connection exceeded its message rate limit.',
        CLOSE_CODES.RATE_LIMITED,
      );
      return;
    }
    if (isBinary || Buffer.byteLength(data) > MAX_MESSAGE_SIZE) {
      sendError(
        ws,
        'BAD_MESSAGE',
        'Messages must be JSON text frames of at most 64 KB.',
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendError(ws, 'BAD_MESSAGE', 'Message must contain valid JSON.', CLOSE_CODES.BAD_MESSAGE);
      return;
    }
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      typeof message.type !== 'string'
    ) {
      sendError(
        ws,
        'BAD_MESSAGE',
        'Message must be a JSON object with a string type.',
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }
    ws.lastMessage = message;
    ws.lastAction = message.type;
    switch (message.type) {
      case 'join':
        joinRoom(ws, message);
        break;
      case 'leave': {
        const room = ws.room && rooms.get(ws.room);
        if (!isNonEmptyString(message.room)) {
          sendError(
            ws,
            'BAD_MESSAGE',
            'leave.room must be a non-empty string.',
            CLOSE_CODES.BAD_MESSAGE,
          );
        } else if (!room || message.room !== room.id) {
          sendError(ws, 'NOT_IN_ROOM', 'The requested room is not your current room.');
        } else {
          leaveRoom(ws);
        }
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        handleRelay(ws, message, message.type);
        break;
      case 'chat': {
        const room = ws.room && rooms.get(ws.room);
        if (!room) sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending this message.');
        else if (typeof message.text !== 'string') {
          sendError(ws, 'BAD_MESSAGE', 'chat.text must be a string.', CLOSE_CODES.BAD_MESSAGE);
        } else if (!room.settings.chatEnabled && !canManage(room, ws)) {
          sendError(ws, 'FORBIDDEN', 'Chat is disabled by the room owner.');
        } else {
          broadcastRoom(room, {
            type: 'chat',
            from: ws.peerId,
            username: ws.username,
            text: message.text,
            ts: new Date().toISOString(),
          });
        }
        break;
      }
      case 'media-state': {
        const room = ws.room && rooms.get(ws.room);
        if (!room) {
          sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending this message.');
        } else if (
          room.settings.screenShare === 'owner' &&
          message.kind === 'screen' &&
          message.active === true &&
          !canManage(room, ws)
        ) {
          sendError(ws, 'FORBIDDEN', 'Only the owner or an admin may share their screen.');
        } else {
          if (message.active) {
            ws.mediaStates.set(message.kind, {
              kind: message.kind,
              active: message.active,
              streamId: message.streamId,
            });
          } else {
            ws.mediaStates.delete(message.kind);
          }
          broadcastRoom(
            room,
            {
              type: 'media-state',
              from: ws.peerId,
              kind: message.kind,
              active: message.active,
              streamId: message.streamId,
            },
            ws,
          );
        }
        break;
      }
      case 'update-settings':
      case 'kick':
      case 'mute-peer':
      case 'mute-all':
      case 'transfer-owner':
      case 'close-room':
        handleRoomAction(ws, message);
        break;
      default:
        sendError(ws, 'BAD_MESSAGE', 'Unknown message type.', CLOSE_CODES.BAD_MESSAGE);
    }
  }

  function statsSnapshot() {
    const now = Date.now();
    while (messageTimes.length && messageTimes[0] <= now - 1000) messageTimes.shift();
    return {
      connections: wss.clients.size,
      peakConnections,
      rooms: rooms.size,
      peers: [...rooms.values()].reduce((total, room) => total + room.peers.size, 0),
      messagesPerSecond: messageTimes.length,
      errorsByCode: Object.fromEntries(errorsByCode),
      uptime: Math.floor((now - startedAt) / 1000),
    };
  }

  function adminIdentity(request) {
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      errorsByCode.set('INVALID_TOKEN', (errorsByCode.get('INVALID_TOKEN') || 0) + 1);
      recordAudit(
        null,
        `admin-api-unauthorized:${request.method}`,
        null,
        null,
        {
          path: request.url,
          error: 'INVALID_TOKEN',
        },
        'denied',
      );
      return { status: 401, error: 'INVALID_TOKEN', message: 'Bearer JWT required.' };
    }
    const identity = verifyToken(match[1], secret);
    if (identity.error) {
      errorsByCode.set(identity.error, (errorsByCode.get(identity.error) || 0) + 1);
      recordAudit(
        null,
        `admin-api-unauthorized:${request.method}`,
        null,
        null,
        {
          path: request.url,
          error: identity.error,
        },
        'denied',
      );
      return { status: 401, ...identity };
    }
    if (identity.role !== 'admin') {
      errorsByCode.set('FORBIDDEN', (errorsByCode.get('FORBIDDEN') || 0) + 1);
      recordAudit(
        identity,
        `forbidden:admin-api:${request.method}`,
        null,
        null,
        { path: request.url },
        'denied',
      );
      return { status: 403, error: 'FORBIDDEN', message: 'Admin role required.' };
    }
    return { identity };
  }

  function roomSummary(room) {
    return {
      id: room.id,
      owner: ownerPeer(room),
      peerCount: room.peers.size,
      settings: { ...room.settings },
      createdAt: room.createdAt,
    };
  }

  async function handleAdminRequest(request, response, requestUrl) {
    const auth = adminIdentity(request);
    if (auth.error) {
      sendJson(response, auth.status, { error: auth.error, message: auth.message });
      return;
    }
    if (!takeHttpRateLimit(auth.identity.userId)) {
      recordAudit(
        auth.identity,
        `admin-api:${request.method} ${requestUrl.pathname}`,
        null,
        null,
        { query: requestUrl.search },
        'denied',
      );
      apiError(response, 429, 'RATE_LIMITED', 'Admin API rate limit exceeded.');
      return;
    }
    let segments;
    try {
      segments = requestUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      apiError(response, 400, 'BAD_REQUEST', 'Invalid URL encoding.');
      return;
    }
    const roomId = segments[1] === 'rooms' ? segments[2] : null;
    recordAudit(
      auth.identity,
      `admin-api:${request.method} ${requestUrl.pathname}`,
      roomId,
      null,
      { query: requestUrl.search },
      'accepted',
    );

    async function readBody() {
      try {
        const content = await readRequestBody(request);
        const parsed = content ? JSON.parse(content) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Body must be a JSON object.');
        }
        return { body: parsed };
      } catch (error) {
        return { error: error.statusCode ? error.message : 'Body must be a valid JSON object.' };
      }
    }

    if (request.method === 'GET' && requestUrl.pathname === '/admin/stats') {
      sendJson(response, 200, statsSnapshot());
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/admin/rooms') {
      sendJson(response, 200, [...rooms.values()].map(roomSummary));
      return;
    }
    if (
      segments.length === 3 &&
      segments[0] === 'admin' &&
      segments[1] === 'rooms' &&
      request.method === 'GET'
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      sendJson(response, 200, {
        ...roomSummary(room),
        peers: [...room.peers.values()].map((peer) => ({
          peerId: peer.peerId,
          userId: peer.userId,
          username: peer.username,
          role: peer.role,
          joinedAt: new Date(peer.joinedAt).toISOString(),
          mediaState: [...peer.mediaStates.values()],
        })),
      });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'rooms' &&
      segments[3] === 'settings' &&
      request.method === 'PATCH'
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      const result = validateSettings(room, body);
      if (result.error) {
        apiError(response, 400, result.error, result.message);
        return;
      }
      room.settings = result.settings;
      broadcastRoomState(room);
      publishAdmin({ type: 'room-updated', room: roomSummary(room) });
      recordAudit(auth.identity, 'settings-change', room.id, null, { settings: room.settings });
      sendJson(response, 200, { ok: true, settings: room.settings });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'rooms' &&
      segments[3] === 'kick' &&
      request.method === 'POST'
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      if (!isNonEmptyString(body.peerId) && !isNonEmptyString(body.userId)) {
        apiError(response, 400, 'BAD_MESSAGE', 'peerId or userId is required.');
        return;
      }
      if (body.ban !== undefined && typeof body.ban !== 'boolean') {
        apiError(response, 400, 'BAD_MESSAGE', 'ban must be a boolean.');
        return;
      }
      const targets = [...room.peers.values()].filter(
        (peer) => peer.peerId === body.peerId || (body.userId && peer.userId === body.userId),
      );
      if (!targets.length) {
        apiError(response, 404, 'PEER_NOT_FOUND', 'Peer is not in the room.');
        return;
      }
      for (const target of targets) {
        kickPeer(room, target, 'Removed by an administrator.', body.ban === true, auth.identity);
      }
      sendJson(response, 200, { ok: true, removed: targets.length });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'rooms' &&
      segments[3] === 'mute' &&
      request.method === 'POST'
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      if (!isNonEmptyString(body.peerId) || !['audio', 'video', 'screen'].includes(body.kind)) {
        apiError(response, 400, 'BAD_MESSAGE', 'peerId and a valid kind are required.');
        return;
      }
      const target = room.peers.get(body.peerId);
      if (!target) {
        apiError(response, 404, 'PEER_NOT_FOUND', 'Peer is not in the room.');
        return;
      }
      send(target, { type: 'force-mute', kind: body.kind, by: auth.identity.userId });
      recordAudit(auth.identity, 'mute-peer', room.id, target.userId, {
        peerId: target.peerId,
        kind: body.kind,
      });
      sendJson(response, 200, { ok: true });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'rooms' &&
      segments[3] === 'transfer-owner' &&
      request.method === 'POST'
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      const target = room.peers.get(body.peerId);
      if (!target) {
        apiError(response, 404, 'PEER_NOT_FOUND', 'The new owner must be in the room.');
        return;
      }
      transferOwner(room, target, auth.identity);
      sendJson(response, 200, { ok: true, owner: ownerPeer(room) });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'rooms' &&
      segments[3] === 'close' &&
      request.method === 'POST'
    ) {
      const room = rooms.get(roomId);
      if (!room) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      if (body.reason !== undefined && typeof body.reason !== 'string') {
        apiError(response, 400, 'BAD_MESSAGE', 'reason must be a string.');
        return;
      }
      closeRoom(room, body.reason || 'Room closed by an administrator.', auth.identity);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/admin/connections') {
      const now = Date.now();
      const connections = [...wss.clients].map((ws) => {
        const recent = (ws.rateTimes || []).filter((time) => time > now - 1000);
        return {
          user: { userId: ws.userId, username: ws.username, role: ws.role },
          ip: ws.clientIp || null,
          room: ws.room || null,
          since: ws.connectedAt ? new Date(ws.connectedAt).toISOString() : null,
          messagesPerSecond: recent.length,
        };
      });
      sendJson(response, 200, connections);
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'users' &&
      segments[3] === 'disconnect' &&
      request.method === 'POST'
    ) {
      const socketsForUser = [...wss.clients].filter((ws) => ws.userId === segments[2]);
      for (const ws of socketsForUser) ws.close(4000, 'Disconnected by administrator.');
      recordAudit(auth.identity, 'user-disconnect', null, segments[2], {
        connections: socketsForUser.length,
      });
      sendJson(response, 200, { ok: true, disconnected: socketsForUser.length });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'users' &&
      segments[3] === 'deny' &&
      request.method === 'POST'
    ) {
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      if (!Number.isInteger(body.minutes) || body.minutes < 1 || body.minutes > 525_600) {
        apiError(response, 400, 'BAD_MESSAGE', 'minutes must be an integer from 1 to 525600.');
        return;
      }
      const expiresAt = Date.now() + body.minutes * 60_000;
      deniedUsers.set(segments[2], { expiresAt, actor: auth.identity });
      const socketsForUser = [...wss.clients].filter((ws) => ws.userId === segments[2]);
      for (const ws of socketsForUser) {
        sendError(
          ws,
          'USER_DENIED',
          'Your account has been denied by an administrator.',
          CLOSE_CODES.USER_DENIED,
        );
      }
      recordAudit(auth.identity, 'user-deny', null, segments[2], {
        minutes: body.minutes,
        expiresAt: new Date(expiresAt).toISOString(),
      });
      sendJson(response, 200, { ok: true, expiresAt: new Date(expiresAt).toISOString() });
      return;
    }
    if (
      segments.length === 4 &&
      segments[0] === 'admin' &&
      segments[1] === 'users' &&
      segments[3] === 'deny' &&
      request.method === 'DELETE'
    ) {
      const existed = deniedUsers.delete(segments[2]);
      recordAudit(auth.identity, 'user-deny-lift', null, segments[2], { existed });
      sendJson(response, 200, { ok: true, existed });
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/admin/announce') {
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      if (
        !isNonEmptyString(body.text) ||
        body.text.length > 4000 ||
        (body.room !== undefined && !isNonEmptyString(body.room))
      ) {
        apiError(
          response,
          400,
          'BAD_MESSAGE',
          'text is required (max 4000 chars); room must be a non-empty string.',
        );
        return;
      }
      const targetRoom = body.room ? rooms.get(body.room) : null;
      if (body.room && !targetRoom) {
        apiError(response, 404, 'ROOM_CLOSED', 'Room does not exist.');
        return;
      }
      const announcement = {
        type: 'announcement',
        text: body.text,
        from: auth.identity.userId,
      };
      if (targetRoom) broadcastRoom(targetRoom, announcement);
      else {
        for (const room of rooms.values()) broadcastRoom(room, announcement);
      }
      recordAudit(auth.identity, 'announcement', body.room || null, null, { text: body.text });
      sendJson(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname === '/admin/config' && request.method === 'GET') {
      sendJson(response, 200, structuredClone(config));
      return;
    }
    if (requestUrl.pathname === '/admin/config' && request.method === 'PUT') {
      const { body, error } = await readBody();
      if (error) {
        apiError(response, 400, 'BAD_MESSAGE', error);
        return;
      }
      const result = validateGlobalConfig(body, config);
      if (result.error) {
        apiError(response, 400, result.error, result.message);
        return;
      }
      try {
        await persistConfig(result.config);
      } catch (writeError) {
        console.error(`Could not persist global config: ${writeError.message}`);
        sendJson(response, 500, { error: 'INTERNAL_ERROR', message: 'Could not persist config.' });
        return;
      }
      const previous = structuredClone(config);
      Object.assign(config, result.config);
      if (config.maxPeersPerRoom < previous.maxPeersPerRoom) {
        for (const room of rooms.values()) {
          if (room.settings.maxPeers > config.maxPeersPerRoom) {
            room.settings = { ...room.settings, maxPeers: config.maxPeersPerRoom };
            broadcastRoomState(room);
            publishAdmin({ type: 'room-updated', room: roomSummary(room) });
            recordAudit(auth.identity, 'settings-change', room.id, null, {
              settings: room.settings,
              reason: 'global-peer-cap-reduced',
            });
          }
        }
      }
      recordAudit(auth.identity, 'config-change', null, null, {
        previous,
        config: structuredClone(config),
      });
      sendJson(response, 200, structuredClone(config));
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/admin/audit') {
      const requestedLimit = Number(requestUrl.searchParams.get('limit') || 100);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 5000) {
        apiError(response, 400, 'BAD_MESSAGE', 'limit must be an integer from 1 to 5000.');
        return;
      }
      const action = requestUrl.searchParams.get('action');
      const filterRoom = requestUrl.searchParams.get('room');
      const user = requestUrl.searchParams.get('user');
      const results = auditEntries.filter((entry) => {
        if (action && entry.action !== action) return false;
        if (filterRoom && entry.room !== filterRoom) return false;
        if (
          user &&
          entry.actor.userId !== user &&
          entry.target !== user &&
          entry.details?.userId !== user
        ) {
          return false;
        }
        return true;
      });
      sendJson(response, 200, results.slice(-requestedLimit).reverse());
      return;
    }
    sendJson(response, 404, { error: 'NOT_FOUND', message: 'Admin endpoint is not implemented.' });
  }

  async function serveStatic(requestUrl, response) {
    if (requestUrl.pathname === '/realtime/reference-client') {
      response.writeHead(308, { Location: '/realtime/reference-client/' });
      response.end();
      return;
    }
    let relativePath;
    try {
      relativePath = decodeURIComponent(
        requestUrl.pathname.slice('/realtime/reference-client'.length),
      );
    } catch {
      sendJson(response, 400, { error: 'BAD_REQUEST', message: 'Invalid file path.' });
      return;
    }
    const requestedPath = relativePath === '/' ? 'index.html' : relativePath.slice(1);
    const filePath = path.resolve(REFERENCE_CLIENT_DIR, requestedPath);
    if (!filePath.startsWith(`${REFERENCE_CLIENT_DIR}${path.sep}`)) {
      sendJson(response, 403, {
        error: 'FORBIDDEN',
        message: 'File path is outside the client directory.',
      });
      return;
    }
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        sendJson(response, 404, { error: 'NOT_FOUND', message: 'File not found.' });
      } else {
        sendJson(response, 500, {
          error: 'INTERNAL_ERROR',
          message: 'Could not read client file.',
        });
        console.error(`Static client file error: ${error.message}`);
      }
    }
  }

  async function handleHttpRequest(request, response) {
    const origin = request.headers.origin;
    const allowedOrigin = !production && origin && isAllowedDevelopmentOrigin(origin);
    if (allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(allowedOrigin ? 204 : 403);
      response.end();
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    } catch {
      sendJson(response, 400, { error: 'BAD_REQUEST', message: 'Invalid request URL.' });
      return;
    }
    if (requestUrl.pathname.startsWith('/admin/')) {
      await handleAdminRequest(request, response, requestUrl);
      return;
    }
    if (requestUrl.pathname === '/dev/token') {
      if (production) {
        sendJson(response, 404, { error: 'NOT_FOUND', message: 'Not found.' });
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await readRequestBody(request));
      } catch (error) {
        sendJson(response, error.statusCode || 400, {
          error: 'BAD_REQUEST',
          message: error.statusCode ? error.message : 'Body must be valid JSON.',
        });
        return;
      }
      const role = payload?.role === undefined ? 'user' : payload.role;
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        !isNonEmptyString(payload.username) ||
        (role !== 'user' && role !== 'admin')
      ) {
        sendJson(response, 400, {
          error: 'BAD_REQUEST',
          message: 'Body must contain a username and optional role "user" or "admin".',
        });
        return;
      }
      const token = jwt.sign(
        { userId: crypto.randomUUID(), username: payload.username.trim(), role },
        secret,
        { algorithm: 'HS256', expiresIn: '1h' },
      );
      sendJson(response, 200, { token });
      return;
    }
    if (
      request.method === 'GET' &&
      (requestUrl.pathname === '/realtime/reference-client' ||
        requestUrl.pathname.startsWith('/realtime/reference-client/'))
    ) {
      await serveStatic(requestUrl, response);
      return;
    }
    sendJson(response, 404, { error: 'NOT_FOUND', message: 'Not found.' });
  }

  server.on('upgrade', (request, socket, head) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    } catch {
      rejectUpgrade(socket, 400, 'BAD_REQUEST', 'The WebSocket request URL is invalid.');
      return;
    }
    const isAdminFeed = requestUrl.pathname === '/ws/admin';
    if (requestUrl.pathname !== '/ws' && !isAdminFeed) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const identity = verifyToken(requestUrl.searchParams.get('token'), secret);
    if (identity.error) {
      closeRejectedWebSocket(
        request,
        socket,
        head,
        identity.error,
        identity.message,
        CLOSE_CODES[identity.error],
      );
      return;
    }
    const denial = deniedUsers.get(identity.userId);
    if (denial && denial.expiresAt > Date.now()) {
      closeRejectedWebSocket(
        request,
        socket,
        head,
        'USER_DENIED',
        'Your account has been denied by an administrator.',
        CLOSE_CODES.USER_DENIED,
        identity,
      );
      return;
    }
    if (denial) deniedUsers.delete(identity.userId);
    if (isAdminFeed && identity.role !== 'admin') {
      closeRejectedWebSocket(
        request,
        socket,
        head,
        'FORBIDDEN',
        'Admin role required.',
        1008,
        identity,
      );
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.peerId = crypto.randomUUID();
      ws.userId = identity.userId;
      ws.username = identity.username;
      ws.role = identity.role;
      ws.room = null;
      ws.joinedAt = null;
      ws.mediaStates = new Map();
      ws.isAdminFeed = isAdminFeed;
      ws.clientIp = request.socket.remoteAddress || null;
      ws.connectedAt = Date.now();
      ws.rateWindowStartedAt = Date.now();
      ws.rateMessageCount = 0;
      ws.rateLimit = config.rateLimit;
      ws.rateTimes = [];
      const userConnections = connectionsByUser.get(ws.userId);
      if (userConnections && userConnections.size >= config.maxConnectionsPerUser) {
        wss.emit('connection', ws, request);
        sendError(
          ws,
          'TOO_MANY_CONNECTIONS',
          'The user has reached the connection limit.',
          CLOSE_CODES.TOO_MANY_CONNECTIONS,
        );
        return;
      }
      const activeConnections = userConnections || new Set();
      activeConnections.add(ws);
      connectionsByUser.set(ws.userId, activeConnections);
      peakConnections = Math.max(peakConnections, wss.clients.size);
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    if (ws.isAdminFeed) {
      adminFeeds.add(ws);
      ws.on('message', () => ws.close(1008, 'Admin feed is server-to-client only.'));
    } else {
      ws.on('message', (data, isBinary) => handleMessage(ws, data, isBinary));
    }
    ws.on('close', () => {
      adminFeeds.delete(ws);
      leaveRoom(ws);
      const userConnections = connectionsByUser.get(ws.userId);
      userConnections?.delete(ws);
      if (userConnections?.size === 0) connectionsByUser.delete(ws.userId);
    });
  });

  return {
    server,
    wss,
    rooms,
    async listen() {
      await loadRuntimeData();
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.removeListener('error', reject);
          statsTimer = setInterval(() => {
            publishAdmin({ type: 'stats', ...statsSnapshot() });
          }, 2000);
          statsTimer.unref?.();
          resolve(server.address());
        });
      });
    },
    async close() {
      if (statsTimer) clearInterval(statsTimer);
      for (const room of rooms.values()) clearRoom(room);
      await new Promise((resolve, reject) => {
        for (const ws of rejectedSockets) ws.terminate();
        for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
        wss.close((wsError) => {
          server.close((serverError) => {
            const error = wsError || serverError;
            if (error) reject(error);
            else resolve();
          });
        });
      });
      await auditWriteChain;
    },
  };
}

if (require.main === module) {
  try {
    const signaling = createSignalingServer();
    signaling.server.on('error', (error) => {
      console.error(`Signaling server error: ${error.message}`);
      process.exitCode = 1;
    });
    signaling
      .listen()
      .then(({ port }) => console.log(`Signaling server listening on port ${port}`))
      .catch((error) => {
        console.error(`Could not start signaling server: ${error.message}`);
        process.exitCode = 1;
      });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createSignalingServer };
