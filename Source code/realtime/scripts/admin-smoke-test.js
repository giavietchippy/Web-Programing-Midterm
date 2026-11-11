'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const jwt = require('jsonwebtoken');
const path = require('node:path');
const WebSocket = require('ws');
const { createSignalingServer } = require('../server');

const SECRET = 'admin-smoke-test-secret';
const WAIT_MS = 40_000;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.events = [];
    ws.waiters = [];
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const index = ws.waiters.findIndex(
        (waiter) => waiter.type === message.type && waiter.predicate(message),
      );
      if (index >= 0) {
        const [waiter] = ws.waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        ws.events.push(message);
      }
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitFor(ws, type, predicate = () => true) {
  const index = ws.events.findIndex((message) => message.type === type && predicate(message));
  if (index >= 0) return Promise.resolve(ws.events.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = {
      type,
      predicate,
      resolve,
      timer: setTimeout(() => {
        ws.waiters = ws.waiters.filter((item) => item !== waiter);
        reject(new Error(`Timed out waiting for ${type}.`));
      }, WAIT_MS),
    };
    ws.waiters.push(waiter);
  });
}

function send(ws, message) {
  ws.send(JSON.stringify(message));
}

function makeToken(userId, username, role) {
  const payload = { userId, username };
  if (role !== undefined) payload.role = role;
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

async function connect(baseUrl, userId, username, role) {
  const token = makeToken(userId, username, role);
  return createClient(`${baseUrl.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
}

async function connectAdminFeed(baseUrl, token) {
  return createClient(
    `${baseUrl.replace('http', 'ws')}/ws/admin?token=${encodeURIComponent(token)}`,
  );
}

function expectUpgradeDenied(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('error', () => {});
    ws.once('open', () => reject(new Error('Expected the WebSocket upgrade to be denied.')));
    ws.once('unexpected-response', (request, response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString()),
        }),
      );
    });
  });
}

async function join(ws, room, settings) {
  const joined = waitFor(ws, 'joined');
  send(ws, settings === undefined ? { type: 'join', room } : { type: 'join', room, settings });
  const result = await joined;
  ws.peerId = result.peerId;
  return result;
}

async function postJson(url, token, body) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function requestJson(url, token, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function main() {
  const app = createSignalingServer({ port: 0, secret: SECRET });
  const address = await app.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sockets = [];
  const connectAndTrack = async (...args) => {
    const ws = await connect(baseUrl, ...args);
    sockets.push(ws);
    return ws;
  };
  let checks = 0;
  const pass = (name) => {
    checks += 1;
    console.log(`PASS ${name}`);
  };

  try {
    const devTokenResponse = await fetch(`${baseUrl}/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'helper-admin', role: 'admin' }),
    });
    assert.equal(devTokenResponse.status, 200);
    const devToken = (await devTokenResponse.json()).token;
    assert.equal(jwt.verify(devToken, SECRET).role, 'admin');

    const owner = await connectAndTrack('owner-1', 'Owner');
    const ownerJoined = await join(owner, 'kick-room');
    assert.equal(ownerJoined.you.role, 'user');
    assert.equal(ownerJoined.owner.userId, 'owner-1');
    assert.deepEqual(ownerJoined.settings, {
      maxPeers: 4,
      locked: false,
      chatEnabled: true,
      screenShare: 'everyone',
    });
    const participant = await connectAndTrack('participant-1', 'Participant');
    const participantJoined = await join(participant, 'kick-room');
    assert.equal(participantJoined.you.role, 'user');
    assert.equal(participantJoined.peers[0].role, 'user');
    const offerWait = waitFor(owner, 'offer');
    send(participant, { type: 'offer', to: owner.peerId, sdp: 'v=0\r\nsmoke-offer' });
    assert.equal((await offerWait).from, participant.peerId);
    const answerWait = waitFor(participant, 'answer');
    send(owner, { type: 'answer', to: participant.peerId, sdp: 'v=0\r\nsmoke-answer' });
    assert.equal((await answerWait).from, owner.peerId);
    const iceWait = waitFor(owner, 'ice-candidate');
    send(participant, {
      type: 'ice-candidate',
      to: owner.peerId,
      candidate: { candidate: 'candidate:host', sdpMid: '0', sdpMLineIndex: 0 },
    });
    assert.equal((await iceWait).from, participant.peerId);
    const chatWait = waitFor(owner, 'chat');
    send(participant, { type: 'chat', text: 'week-one-chat' });
    assert.equal((await chatWait).text, 'week-one-chat');
    const victim = await connectAndTrack('victim-1', 'Victim');
    await join(victim, 'kick-room');

    const forbiddenKick = waitFor(participant, 'error');
    send(participant, { type: 'kick', peerId: victim.peerId });
    assert.equal((await forbiddenKick).code, 'FORBIDDEN');
    const forgedRole = waitFor(participant, 'error');
    send(participant, { type: 'close-room', role: 'admin' });
    assert.equal((await forgedRole).code, 'FORBIDDEN');
    const kickedWait = waitFor(victim, 'kicked');
    const peerLeftWait = waitFor(participant, 'peer-left');
    send(owner, { type: 'kick', peerId: victim.peerId, reason: 'smoke test' });
    assert.equal((await kickedWait).reason, 'smoke test');
    assert.equal((await peerLeftWait).peerId, victim.peerId);
    pass('verified roles, forged-role rejection, participant FORBIDDEN, and owner kick');

    const fullOwner = await connectAndTrack('full-owner', 'Full owner');
    const fullJoined = await join(fullOwner, 'full-room', { maxPeers: 2 });
    assert.equal(fullJoined.settings.maxPeers, 2);
    const fullPeer = await connectAndTrack('full-peer', 'Full peer');
    await join(fullPeer, 'full-room');
    const fullThird = await connectAndTrack('full-third', 'Full third');
    const fullError = waitFor(fullThird, 'error');
    send(fullThird, { type: 'join', room: 'full-room' });
    assert.equal((await fullError).code, 'ROOM_FULL');
    const adminFull = await connectAndTrack('admin-full', 'Admin full', 'admin');
    const adminFullJoined = await join(adminFull, 'full-room');
    assert.equal(adminFullJoined.you.role, 'admin');
    assert.equal(adminFullJoined.owner.userId, 'full-owner');
    const ownerKickAdmin = waitFor(fullOwner, 'error');
    send(fullOwner, { type: 'kick', peerId: adminFull.peerId });
    assert.equal((await ownerKickAdmin).code, 'FORBIDDEN');

    const lockOwner = await connectAndTrack('lock-owner', 'Lock owner');
    const lockedJoined = await join(lockOwner, 'locked-room', { locked: true });
    assert.equal(lockedJoined.settings.locked, true);
    const ownerLockedJoin = await connectAndTrack('lock-owner', 'Lock owner');
    assert.equal((await join(ownerLockedJoin, 'locked-room')).owner.userId, 'lock-owner');
    const lockedUser = await connectAndTrack('locked-user', 'Locked user');
    const lockedError = waitFor(lockedUser, 'error');
    send(lockedUser, { type: 'join', room: 'locked-room' });
    assert.equal((await lockedError).code, 'ROOM_LOCKED');
    const lockedAdmin = await connectAndTrack('locked-admin', 'Locked admin', 'admin');
    assert.equal((await join(lockedAdmin, 'locked-room')).you.role, 'admin');
    const adminCreated = await connectAndTrack('admin-created', 'Admin created', 'admin');
    const adminCreatedJoin = await join(adminCreated, 'admin-created-room');
    assert.equal(adminCreatedJoin.you.role, 'admin');
    assert.deepEqual(adminCreatedJoin.owner, { peerId: null, userId: null });
    pass('room maxPeers and locked checks, with admin bypass');

    const refreshOwner = await connectAndTrack('refresh-owner', 'Refresh owner');
    await join(refreshOwner, 'refresh-room');
    const refreshPeer = await connectAndTrack('refresh-peer', 'Refresh peer');
    await join(refreshPeer, 'refresh-room');
    const ownerClosed = new Promise((resolve) => refreshOwner.once('close', resolve));
    refreshOwner.close();
    await ownerClosed;
    const returningOwner = await connectAndTrack('refresh-owner', 'Refresh owner');
    const refreshedJoin = await join(returningOwner, 'refresh-room');
    assert.equal(refreshedJoin.owner.userId, 'refresh-owner');
    assert.equal(refreshedJoin.you.role, 'user');
    pass('owner refresh within grace period retains ownership');

    const timedOwner = await connectAndTrack('timed-owner', 'Timed owner');
    await join(timedOwner, 'transfer-room');
    const earliest = await connectAndTrack('earliest-peer', 'Earliest');
    await join(earliest, 'transfer-room');
    await pause(20);
    const later = await connectAndTrack('later-peer', 'Later');
    await join(later, 'transfer-room');
    const transferredState = waitFor(
      earliest,
      'room-state',
      (message) => message.owner.userId === 'earliest-peer',
    );
    const timedOwnerClosed = new Promise((resolve) => timedOwner.once('close', resolve));
    timedOwner.close();
    await timedOwnerClosed;
    const transfer = await transferredState;
    assert.equal(transfer.owner.userId, 'earliest-peer');
    pass('owner transfers to earliest participant after 30-second grace period');

    const invalidSettings = waitFor(fullOwner, 'error');
    send(fullOwner, { type: 'update-settings', settings: { maxPeers: 5 } });
    assert.equal((await invalidSettings).code, 'INVALID_SETTING');
    const adminToken = makeToken('admin-api', 'Admin API', 'admin');
    const userToken = makeToken('normal-api', 'Normal API');
    const deniedFeed = await expectUpgradeDenied(
      `${baseUrl.replace('http', 'ws')}/ws/admin?token=${encodeURIComponent(userToken)}`,
    );
    assert.equal(deniedFeed.status, 403);
    assert.equal(deniedFeed.body.code, 'FORBIDDEN');
    for (const endpoint of ['/admin/stats', '/admin/rooms']) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      assert.equal(response.status, 403);
    }
    const nonAdminPost = await fetch(`${baseUrl}/admin/rooms/unimplemented/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(nonAdminPost.status, 403);
    const allowedCors = await fetch(`${baseUrl}/admin/stats`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(allowedCors.status, 204);
    assert.equal(allowedCors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const rejectedCors = await fetch(`${baseUrl}/admin/stats`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com' },
    });
    assert.equal(rejectedCors.status, 403);
    assert.equal((await fetch(`${baseUrl}/admin/stats`)).status, 401);
    const statsResponse = await fetch(`${baseUrl}/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(statsResponse.status, 200);
    const stats = await statsResponse.json();
    assert.equal(typeof stats.connections, 'number');
    assert.equal(typeof stats.peakConnections, 'number');
    assert.equal(typeof stats.messagesPerSecond, 'number');
    assert.equal(typeof stats.errorsByCode.FORBIDDEN, 'number');
    const roomsResponse = await fetch(`${baseUrl}/admin/rooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(roomsResponse.status, 200);
    const rooms = await roomsResponse.json();
    assert(rooms.some((room) => room.id === 'transfer-room'));
    const allRooms = await fetch(`${baseUrl}/admin/rooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((response) => response.json());
    assert(allRooms.every((room) => typeof room.createdAt === 'string'));
    pass('settings upper cap and authenticated admin GET endpoints');

    const transferOwner = await connectAndTrack('transfer-now-owner', 'Transfer owner');
    await join(transferOwner, 'transfer-now-room');
    const transferTarget = await connectAndTrack('transfer-now-target', 'Transfer target');
    await join(transferTarget, 'transfer-now-room');
    const explicitTransfer = waitFor(
      transferTarget,
      'room-state',
      (message) => message.owner.userId === 'transfer-now-target',
    );
    send(transferOwner, { type: 'transfer-owner', peerId: transferTarget.peerId });
    assert.equal((await explicitTransfer).owner.peerId, transferTarget.peerId);

    const apiKickOwner = await connectAndTrack('api-kick-owner', 'API kick owner');
    await join(apiKickOwner, 'api-kick-room');
    const apiKickTarget = await connectAndTrack('api-kick-target', 'API kick target');
    await join(apiKickTarget, 'api-kick-room');
    const apiKicked = waitFor(apiKickTarget, 'kicked');
    const kickResponse = await postJson(`${baseUrl}/admin/rooms/api-kick-room/kick`, adminToken, {
      peerId: apiKickTarget.peerId,
    });
    assert.equal(kickResponse.status, 200);
    assert.equal((await apiKicked).banned, false);

    const apiTransferOwner = await connectAndTrack('api-transfer-owner', 'API transfer owner');
    await join(apiTransferOwner, 'api-transfer-room');
    const apiTransferTarget = await connectAndTrack('api-transfer-target', 'API transfer target');
    await join(apiTransferTarget, 'api-transfer-room');
    const adminTransfer = await postJson(
      `${baseUrl}/admin/rooms/api-transfer-room/transfer-owner`,
      adminToken,
      { peerId: apiTransferTarget.peerId },
    );
    assert.equal(adminTransfer.status, 200);
    assert.equal((await adminTransfer.json()).owner.userId, 'api-transfer-target');

    const closeOwner = await connectAndTrack('close-owner', 'Close owner');
    await join(closeOwner, 'admin-close-room');
    const closePeer = await connectAndTrack('close-peer', 'Close peer');
    await join(closePeer, 'admin-close-room');
    const closeOwnerNotice = waitFor(closeOwner, 'room-closed');
    const closePeerNotice = waitFor(closePeer, 'room-closed');
    const closeResponse = await postJson(
      `${baseUrl}/admin/rooms/admin-close-room/close`,
      adminToken,
      { reason: 'admin smoke' },
    );
    assert.equal(closeResponse.status, 200);
    assert.equal((await closeOwnerNotice).reason, 'admin smoke');
    assert.equal((await closePeerNotice).reason, 'admin smoke');
    const roomsAfterClose = await (
      await fetch(`${baseUrl}/admin/rooms`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    ).json();
    assert.equal(
      roomsAfterClose.some((room) => room.id === 'admin-close-room'),
      false,
    );
    pass('admin API kick, room close notifications, and room removal');

    const feed = await connectAdminFeed(baseUrl, adminToken);
    sockets.push(feed);
    const statsFeed = await waitFor(feed, 'stats');
    assert.equal(typeof statsFeed.messagesPerSecond, 'number');
    const p2Owner = await connectAndTrack('p2-owner', 'P2 owner');
    const roomCreated = waitFor(feed, 'room-created', (message) => message.room.id === 'p2-room');
    await join(p2Owner, 'p2-room');
    assert.equal((await roomCreated).room.owner.userId, 'p2-owner');
    const p2Peer = await connectAndTrack('p2-peer', 'P2 peer');
    const peerJoinedFeed = waitFor(
      feed,
      'peer-joined',
      (message) => message.room === 'p2-room' && message.peer.userId === 'p2-peer',
    );
    await join(p2Peer, 'p2-room');
    assert.equal((await peerJoinedFeed).peer.role, 'user');

    const mediaState = waitFor(p2Peer, 'media-state', (message) => message.from === p2Owner.peerId);
    send(p2Owner, {
      type: 'media-state',
      kind: 'video',
      active: true,
      streamId: 'p2-stream',
    });
    await mediaState;
    const detailResponse = await fetch(`${baseUrl}/admin/rooms/p2-room`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(
      detail.peers.find((peer) => peer.userId === 'p2-owner').mediaState[0].streamId,
      'p2-stream',
    );

    const forceMute = waitFor(p2Peer, 'force-mute');
    send(p2Owner, { type: 'mute-peer', peerId: p2Peer.peerId, kind: 'audio' });
    assert.deepEqual(await forceMute, { type: 'force-mute', kind: 'audio', by: 'p2-owner' });
    const forceMuteAll = waitFor(p2Peer, 'force-mute', (message) => message.kind === 'screen');
    send(p2Owner, { type: 'mute-all', kind: 'screen' });
    assert.equal((await forceMuteAll).by, 'p2-owner');
    const muteApi = await postJson(`${baseUrl}/admin/rooms/p2-room/mute`, adminToken, {
      peerId: p2Peer.peerId,
      kind: 'video',
    });
    assert.equal(muteApi.status, 200);
    assert.equal((await waitFor(p2Peer, 'force-mute')).kind, 'video');

    const auditEvent = waitFor(
      feed,
      'audit',
      (message) => message.entry.action === 'settings-change' && message.entry.room === 'p2-room',
    );
    const settingsPatch = await requestJson(
      `${baseUrl}/admin/rooms/p2-room/settings`,
      adminToken,
      'PATCH',
      { chatEnabled: false },
    );
    assert.equal(settingsPatch.response.status, 200);
    assert.equal(settingsPatch.body.settings.chatEnabled, false);
    await auditEvent;
    const disabledChat = waitFor(p2Peer, 'error');
    send(p2Peer, { type: 'chat', text: 'blocked' });
    assert.equal((await disabledChat).code, 'FORBIDDEN');
    const enableChat = await requestJson(
      `${baseUrl}/admin/rooms/p2-room/settings`,
      adminToken,
      'PATCH',
      { chatEnabled: true },
    );
    assert.equal(enableChat.response.status, 200);
    const screenSettings = await requestJson(
      `${baseUrl}/admin/rooms/p2-room/settings`,
      adminToken,
      'PATCH',
      { screenShare: 'owner' },
    );
    assert.equal(screenSettings.response.status, 200);
    const blockedScreen = waitFor(p2Peer, 'error');
    send(p2Peer, {
      type: 'media-state',
      kind: 'screen',
      active: true,
      streamId: 'blocked-screen',
    });
    assert.equal((await blockedScreen).code, 'FORBIDDEN');
    const ownerScreen = waitFor(p2Peer, 'media-state', (message) => message.kind === 'screen');
    send(p2Owner, {
      type: 'media-state',
      kind: 'screen',
      active: true,
      streamId: 'owner-screen',
    });
    assert.equal((await ownerScreen).streamId, 'owner-screen');

    const bannedPeer = await connectAndTrack('banned-peer', 'Banned peer');
    await join(bannedPeer, 'p2-room');
    const kickedAndBanned = waitFor(bannedPeer, 'kicked');
    send(p2Owner, { type: 'kick', peerId: bannedPeer.peerId, ban: true });
    assert.equal((await kickedAndBanned).banned, true);
    const bannedRejoin = waitFor(bannedPeer, 'error');
    send(bannedPeer, { type: 'join', room: 'p2-room' });
    assert.equal((await bannedRejoin).code, 'BANNED_FROM_ROOM');

    const announcement = waitFor(p2Peer, 'announcement');
    const announceResponse = await postJson(`${baseUrl}/admin/announce`, adminToken, {
      text: 'P2 announcement',
      room: 'p2-room',
    });
    assert.equal(announceResponse.status, 200);
    assert.equal((await announcement).from, 'admin-api');
    const connectionsResponse = await fetch(`${baseUrl}/admin/connections`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(connectionsResponse.status, 200);
    const connections = await connectionsResponse.json();
    assert(connections.some((connection) => connection.user.userId === 'p2-peer'));
    const overCapPeer = await connectAndTrack('over-cap-peer', 'Over-cap peer');
    await join(overCapPeer, 'p2-room');
    pass('admin feed, room details/settings, mute requests, announcements, and connections');

    const originalConfigResponse = await fetch(`${baseUrl}/admin/config`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const originalConfig = await originalConfigResponse.json();
    const changedConfig = await requestJson(`${baseUrl}/admin/config`, adminToken, 'PUT', {
      maxPeersPerRoom: 2,
    });
    assert.equal(changedConfig.response.status, 200);
    assert.equal(changedConfig.body.maxPeersPerRoom, 2);
    const reducedRoom = await fetch(`${baseUrl}/admin/rooms/p2-room`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((response) => response.json());
    assert.equal(reducedRoom.settings.maxPeers, 2);
    assert.equal(reducedRoom.peerCount, 3);
    const cappedJoiner = await connectAndTrack('capped-joiner', 'Capped joiner');
    const cappedSettings = waitFor(cappedJoiner, 'error');
    send(cappedJoiner, { type: 'join', room: 'cap-room', settings: { maxPeers: 3 } });
    assert.equal((await cappedSettings).code, 'INVALID_SETTING');
    const fullAfterCap = waitFor(cappedJoiner, 'error');
    send(cappedJoiner, { type: 'join', room: 'p2-room' });
    assert.equal((await fullAfterCap).code, 'ROOM_FULL');
    const restoredConfig = await requestJson(
      `${baseUrl}/admin/config`,
      adminToken,
      'PUT',
      originalConfig,
    );
    assert.equal(restoredConfig.response.status, 200);
    pass('runtime config persistence and global room cap validation');

    const deniedUser = await connectAndTrack('denied-user', 'Denied user');
    const deniedClosed = new Promise((resolve) => deniedUser.once('close', resolve));
    const denyResponse = await postJson(`${baseUrl}/admin/users/denied-user/deny`, adminToken, {
      minutes: 1,
    });
    assert.equal(denyResponse.status, 200);
    assert.equal((await waitFor(deniedUser, 'error')).code, 'USER_DENIED');
    await deniedClosed;
    const disconnectedUser = await connectAndTrack('disconnected-user', 'Disconnected user');
    const disconnected = new Promise((resolve) => disconnectedUser.once('close', resolve));
    const disconnectResponse = await postJson(
      `${baseUrl}/admin/users/disconnected-user/disconnect`,
      adminToken,
      {},
    );
    assert.equal(disconnectResponse.status, 200);
    await disconnected;
    const deniedReconnect = await expectUpgradeDenied(
      `${baseUrl.replace('http', 'ws')}/ws?token=${encodeURIComponent(
        makeToken('denied-user', 'Denied user'),
      )}`,
    );
    assert.equal(deniedReconnect.status, 403);
    assert.equal(deniedReconnect.body.code, 'USER_DENIED');
    const liftResponse = await fetch(`${baseUrl}/admin/users/denied-user/deny`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(liftResponse.status, 200);
    const reconnected = await connectAndTrack('denied-user', 'Denied user');
    assert.equal(reconnected.readyState, WebSocket.OPEN);
    pass('user deny disconnects, rejects reconnect, and can be lifted');

    const auditResponse = await fetch(`${baseUrl}/admin/audit?limit=500`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json();
    assert(audit.some((entry) => entry.action === 'forbidden:kick' && entry.result === 'denied'));
    assert(audit.some((entry) => entry.action === 'user-deny'));
    assert(audit.some((entry) => entry.action === 'mute-all'));
    assert(audit.some((entry) => entry.action === 'config-change'));
    const persistedAudit = await fs.readFile(
      path.join(__dirname, '..', 'data', 'audit.jsonl'),
      'utf8',
    );
    assert(persistedAudit.split(/\r?\n/).some((line) => line.includes('"action":"user-deny"')));
    pass('audit filtering, forbidden-attempt logging, and JSONL persistence');

    console.log(`PASS ${checks} P1/P2 smoke-test groups completed.`);
  } finally {
    for (const ws of sockets) {
      ws.removeAllListeners('error');
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
        ws.terminate();
    }
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
