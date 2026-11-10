'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const path = require('node:path');
const WebSocket = require('ws');

const MAX_PEERS_PER_ROOM = 4;
const MAX_CONNECTIONS_PER_USER = 3;
const MAX_MESSAGE_SIZE = 64 * 1024;
const MAX_HTTP_BODY_SIZE = 8 * 1024;
const MAX_TRANSPORT_PAYLOAD = 1024 * 1024;
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
  BAD_MESSAGE: 4004,
  TOO_MANY_CONNECTIONS: 4005,
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUpgrade(socket, code, message) {
  const body = JSON.stringify({ code, message });
  socket.write(
    `HTTP/1.1 401 Unauthorized\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
      body,
  );
  socket.destroy();
}

function verifyToken(token, secret) {
  if (!token) {
    return { error: 'INVALID_TOKEN', message: 'A JWT is required.' };
  }

  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (
      typeof claims !== 'object' ||
      claims === null ||
      !isNonEmptyString(claims.userId) ||
      !isNonEmptyString(claims.username) ||
      !Number.isInteger(claims.iat) ||
      !Number.isInteger(claims.exp)
    ) {
      return { error: 'INVALID_TOKEN', message: 'The JWT claims are invalid.' };
    }

    return { userId: claims.userId, username: claims.username };
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

function readRequestBody(request, maxSize) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        tooLarge = true;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
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

  const rooms = new Map();
  const connectionsByUser = new Map();
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    const allowedOrigin = !production && origin && isAllowedDevelopmentOrigin(origin);
    if (allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
        const body = await readRequestBody(request, MAX_HTTP_BODY_SIZE);
        payload = JSON.parse(body);
      } catch (error) {
        sendJson(response, error.statusCode || 400, {
          error: 'BAD_REQUEST',
          message: error.statusCode ? error.message : 'Body must be valid JSON.',
        });
        return;
      }
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        !isNonEmptyString(payload.username)
      ) {
        sendJson(response, 400, {
          error: 'BAD_REQUEST',
          message: 'Body must contain a non-empty username string.',
        });
        return;
      }

      const token = jwt.sign(
        { userId: crypto.randomUUID(), username: payload.username.trim() },
        secret,
        { algorithm: 'HS256', expiresIn: '1h' },
      );
      sendJson(response, 200, { token });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/realtime/reference-client') {
      response.writeHead(308, { Location: '/realtime/reference-client/' });
      response.end();
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname.startsWith('/realtime/reference-client/')) {
      let relativePath;
      try {
        relativePath = decodeURIComponent(
          requestUrl.pathname.slice('/realtime/reference-client'.length),
        );
      } catch {
        sendJson(response, 400, { error: 'BAD_REQUEST', message: 'Invalid file path.' });
        return;
      }
      const requestedPath =
        relativePath === '' || relativePath === '/' ? 'index.html' : relativePath.slice(1);
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
      return;
    }

    sendJson(response, 404, { error: 'NOT_FOUND', message: 'Not found.' });
  });
  const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_TRANSPORT_PAYLOAD });

  function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function sendError(ws, code, message, closeCode) {
    if (closeCode) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'error', code, message }), (error) => {
        if (error) {
          ws.terminate();
        } else {
          ws.close(closeCode, code);
        }
      });
      return;
    }
    send(ws, { type: 'error', code, message });
  }

  function leaveRoom(ws) {
    if (!ws.room) return;
    const roomName = ws.room;
    const peers = rooms.get(roomName);
    if (!peers) {
      ws.room = null;
      return;
    }

    peers.delete(ws.peerId);
    ws.room = null;
    for (const peer of peers.values()) {
      send(peer, { type: 'peer-left', peerId: ws.peerId });
    }
    if (peers.size === 0) {
      rooms.delete(roomName);
    }
  }

  function handleJoin(ws, message) {
    if (!isNonEmptyString(message.room)) {
      sendError(
        ws,
        'BAD_MESSAGE',
        'join.room must be a non-empty string.',
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }

    const roomName = message.room;
    const targetRoom = rooms.get(roomName);
    if (targetRoom && !targetRoom.has(ws.peerId) && targetRoom.size >= MAX_PEERS_PER_ROOM) {
      sendError(ws, 'ROOM_FULL', 'The room has reached its peer limit.');
      return;
    }

    if (ws.room === roomName) {
      const peers = [...targetRoom.values()]
        .filter((peer) => peer.peerId !== ws.peerId)
        .map((peer) => ({ peerId: peer.peerId, username: peer.username }));
      send(ws, { type: 'joined', peerId: ws.peerId, room: roomName, peers });
      return;
    }

    leaveRoom(ws);
    const peers = rooms.get(roomName) || new Map();
    const existingPeers = [...peers.values()].map((peer) => ({
      peerId: peer.peerId,
      username: peer.username,
    }));
    peers.set(ws.peerId, ws);
    rooms.set(roomName, peers);
    ws.room = roomName;

    send(ws, { type: 'joined', peerId: ws.peerId, room: roomName, peers: existingPeers });
    for (const peer of peers.values()) {
      if (peer.peerId !== ws.peerId) {
        send(peer, { type: 'peer-joined', peerId: ws.peerId, username: ws.username });
      }
    }
  }

  function handleRelay(ws, message, type) {
    if (!ws.room) {
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
    if (type === 'offer' || type === 'answer') {
      if (typeof message.sdp !== 'string') {
        sendError(ws, 'BAD_MESSAGE', `${type}.sdp must be a string.`, CLOSE_CODES.BAD_MESSAGE);
        return;
      }
    } else if (
      typeof message.candidate !== 'object' ||
      message.candidate === null ||
      Array.isArray(message.candidate)
    ) {
      sendError(
        ws,
        'BAD_MESSAGE',
        'ice-candidate.candidate must be an object.',
        CLOSE_CODES.BAD_MESSAGE,
      );
      return;
    }

    const target = rooms.get(ws.room)?.get(message.to);
    if (!target || target.readyState !== WebSocket.OPEN) {
      sendError(ws, 'PEER_NOT_FOUND', 'The target peer is not in your room.');
      return;
    }

    const forwarded = { type, from: ws.peerId, to: message.to };
    if (type === 'ice-candidate') {
      forwarded.candidate = message.candidate;
    } else {
      forwarded.sdp = message.sdp;
    }
    send(target, forwarded);
  }

  function handleMessage(ws, data, isBinary) {
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

    switch (message.type) {
      case 'join':
        handleJoin(ws, message);
        break;
      case 'leave':
        if (!isNonEmptyString(message.room)) {
          sendError(
            ws,
            'BAD_MESSAGE',
            'leave.room must be a non-empty string.',
            CLOSE_CODES.BAD_MESSAGE,
          );
        } else if (!ws.room || message.room !== ws.room) {
          sendError(ws, 'NOT_IN_ROOM', 'The requested room is not your current room.');
        } else {
          leaveRoom(ws);
        }
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        handleRelay(ws, message, message.type);
        break;
      case 'chat':
        if (!ws.room) {
          sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending this message.');
        } else if (typeof message.text !== 'string') {
          sendError(ws, 'BAD_MESSAGE', 'chat.text must be a string.', CLOSE_CODES.BAD_MESSAGE);
        } else {
          const chat = {
            type: 'chat',
            from: ws.peerId,
            username: ws.username,
            text: message.text,
            ts: new Date().toISOString(),
          };
          for (const peer of rooms.get(ws.room).values()) {
            send(peer, chat);
          }
        }
        break;
      case 'media-state':
        if (!ws.room) {
          sendError(ws, 'NOT_IN_ROOM', 'Join a room before sending this message.');
        } else {
          const mediaState = {
            type: 'media-state',
            from: ws.peerId,
            kind: message.kind,
            active: message.active,
            streamId: message.streamId,
          };
          for (const peer of rooms.get(ws.room).values()) {
            if (peer !== ws) send(peer, mediaState);
          }
        }
        break;
      default:
        sendError(ws, 'BAD_MESSAGE', 'Unknown message type.', CLOSE_CODES.BAD_MESSAGE);
    }
  }

  server.on('upgrade', (request, socket, head) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    } catch {
      rejectUpgrade(socket, 'INVALID_TOKEN', 'The WebSocket request URL is invalid.');
      return;
    }
    if (requestUrl.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const identity = verifyToken(requestUrl.searchParams.get('token'), secret);
    if (identity.error) {
      rejectUpgrade(socket, identity.error, identity.message);
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.peerId = crypto.randomUUID();
      ws.userId = identity.userId;
      ws.username = identity.username;
      ws.room = null;

      const userConnections = connectionsByUser.get(ws.userId);
      if (userConnections && userConnections.size >= MAX_CONNECTIONS_PER_USER) {
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
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => handleMessage(ws, data, isBinary));
    ws.on('close', () => {
      leaveRoom(ws);
      const userConnections = connectionsByUser.get(ws.userId);
      userConnections?.delete(ws);
      if (userConnections?.size === 0) {
        connectionsByUser.delete(ws.userId);
      }
    });
  });

  return {
    server,
    wss,
    rooms,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const ws of wss.clients) {
          ws.close(1001, 'Server shutting down');
        }
        wss.close((wsError) => {
          server.close((serverError) => {
            const error = wsError || serverError;
            if (error) reject(error);
            else resolve();
          });
        });
      });
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
      .then(({ port }) => {
        console.log(`Signaling server listening on port ${port}`);
      })
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
