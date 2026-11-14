'use strict';
// Run from Source code/: node scripts/session-version-test.cjs
// Starts Platform + Real-time on isolated ports and temporary SQLite directories.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const WebSocket = require('../realtime/node_modules/ws');
const root = path.resolve(__dirname, '..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'webrtc-session-version-'));
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const INTERNAL_API_KEY = crypto.randomBytes(32).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const children = [];

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}
async function healthy(url) {
  for (let n = 0; n < 70; n++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(120);
  }
  throw new Error(`Server did not start: ${url}`);
}
function spawnService(folder, env) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(root, folder),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', chunk => process.stdout.write(`${folder}: ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`${folder}: ${chunk}`));
  return child;
}
function decode(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
}
async function main() {
  const platformPort = await freePort();
  let realtimePort = await freePort();
  while (realtimePort === platformPort) realtimePort = await freePort();
  const platform = `http://127.0.0.1:${platformPort}`;
  const realtime = `http://127.0.0.1:${realtimePort}`;
  const env = { JWT_SECRET, INTERNAL_API_KEY, NODE_ENV: 'development' };
  spawnService('platform', {
    ...env,
    TRUST_PROXY: 'true', PLATFORM_PORT: String(platformPort),
    REALTIME_URL: realtime, PLATFORM_DATA_DIR: path.join(tmp, 'platform'),
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin-strong-password',
  });
  await healthy(`${platform}/health`);
  spawnService('realtime', {
    ...env,
    PORT: String(realtimePort), PLATFORM_URL: platform,
    REALTIME_DATA_DIR: path.join(tmp, 'realtime'),
  });
  await healthy(`${realtime}/dev/token`).catch(async () => {
    // /dev/token is POST-only and responds 405 to GET; 405 means service is ready.
    for (let i=0;i<50;i++) { try { if((await fetch(`${realtime}/dev/token`)).status===405) return; }catch{} await sleep(100); }
    throw Error('Realtime not ready');
  });

  async function api(route, { token, method = 'GET', data, headers = {} } = {}) {
    const response = await fetch(platform + route, {
      method,
      headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body };
  }
  async function login(username, password) {
    const result = await api('/api/login', { method:'POST', data:{ username, password } });
    assert.equal(result.status, 200, JSON.stringify(result));
    return result.body.token;
  }
  const rtAdminStatus = async token => (await fetch(`${realtime}/admin/stats`, { headers:{ Authorization:`Bearer ${token}` } })).status;
  function websocket(token) {
    const ws = new WebSocket(`ws://127.0.0.1:${realtimePort}/ws?token=${encodeURIComponent(token)}`);
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 4000);
      ws.once('open',() => {clearTimeout(timer);resolve(ws)});
      ws.once('error',e => {clearTimeout(timer);reject(e)});
    });
  }
  function awaitClose(socket) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('WebSocket did not close after revoke')),3500);
      socket.once('close',(code)=>{clearTimeout(timer);resolve(code)});
    });
  }

  const admin = await login('admin', 'admin-strong-password');
  const added = await api('/api/admin/users', { token: admin, method:'POST', data:{ username:'moderator', password:'original-password', role:'admin' } });
  assert.equal(added.status,201);
  const id = added.body.user.id;
  const v0Admin = await login('moderator', 'original-password');
  assert.equal(decode(v0Admin).sessionVersion,0);
  assert.equal(await rtAdminStatus(v0Admin),200);
  console.log('PASS new tokens contain sessionVersion=0');

  const firstDown = await api(`/api/admin/users/${id}`, { token:admin, method:'PATCH', data:{role:'user'} });
  assert.equal(firstDown.status,200);
  assert.equal(firstDown.body.realtimeSync,true);
  assert.equal((await api('/api/me',{token:v0Admin})).status,401);
  assert.equal(await rtAdminStatus(v0Admin),401);
  const v1User = await login('moderator','original-password');
  assert.equal(decode(v1User).sessionVersion,1);
  assert.equal((await api('/api/me',{token:v1User})).status,200);
  console.log('PASS demote invalidates old REST + realtime JWT, new login works immediately');

  const retry = await api(`/api/admin/users/${id}`, { token:admin, method:'PATCH', data:{role:'user'} });
  assert.equal(retry.status,200);
  assert.equal(retry.body.realtimeSync,true);
  assert.equal((await api('/api/me',{token:v1User})).status,200);
  console.log('PASS retrying identical PATCH does not revoke current-version token');

  const firstUp = await api(`/api/admin/users/${id}`, { token:admin, method:'PATCH', data:{role:'admin'} });
  assert.equal(firstUp.status,200);
  const v2Admin = await login('moderator', 'original-password');
  assert.equal(decode(v2Admin).sessionVersion,2);
  assert.equal(await rtAdminStatus(v2Admin),200);
  const secondDown = await api(`/api/admin/users/${id}`, { token:admin, method:'PATCH', data:{role:'user'} });
  assert.equal(secondDown.status,200);
  assert.equal(secondDown.body.realtimeSync,true);
  assert.equal((await api('/api/me',{token:v2Admin})).status,401);
  assert.equal(await rtAdminStatus(v2Admin),401);
  console.log('PASS second demotion also revokes newly issued token (old timestamp bug fixed)');

  const v3User = await login('moderator', 'original-password');
  assert.equal(decode(v3User).sessionVersion,3);
  const sock = await websocket(v3User);
  const closed = awaitClose(sock);
  const reset = await api(`/api/admin/users/${id}/password`, { token:admin, method:'POST', data:{password:'fresh-password-234'} });
  assert.equal(reset.status,204);
  assert.equal(await closed,4001);
  assert.equal((await api('/api/me', { token:v3User })).status,401);
  assert.equal((await api('/api/login', {method:'POST',data:{username:'moderator',password:'original-password'}})).status,401);
  const v4User = await login('moderator','fresh-password-234');
  assert.equal(decode(v4User).sessionVersion,4);
  assert.equal((await api('/api/me', { token:v4User })).status,200);
  console.log('PASS reset password revokes REST JWT + active WebSocket, new login works');

  const firstIp = { 'X-Forwarded-For': '198.51.100.11' };
  const secondIp = { 'X-Forwarded-For': '198.51.100.12' };
  for(let n=0;n<10;n++) assert.equal((await api('/api/login',{method:'POST',headers:firstIp,data:{username:'nope',password:'wrongpassword'}})).status,401);
  assert.equal((await api('/api/login',{method:'POST',headers:firstIp,data:{username:'nope',password:'wrongpassword'}})).status,429);
  assert.equal((await api('/api/login',{method:'POST',headers:secondIp,data:{username:'nope',password:'wrongpassword'}})).status,401);
  console.log('PASS proxy-aware rate limit isolates forwarded IPs (test assumes trusted proxy)');

  // Revoke while realtime is offline: Platform saves a pending event in SQLite,
  // then retries automatically after the signaling server returns.
  const addedOffline = await api('/api/admin/users', { token:admin, method:'POST', data:{
    username:'offlineadmin', password:'offline-original-pw', role:'admin',
  } });
  assert.equal(addedOffline.status,201);
  const offlineId = addedOffline.body.user.id;
  const offlineOldToken = await login('offlineadmin','offline-original-pw');
  const rtProcess = children[1];
  const exited = new Promise(resolve => rtProcess.once('exit',resolve));
  rtProcess.kill();
  await exited;
  const offlineReset = await api(`/api/admin/users/${offlineId}/password`, {
    token:admin, method:'POST', data:{password:'offline-new-password'},
  });
  assert.equal(offlineReset.status,204);
  assert.equal((await api('/api/me',{token:offlineOldToken})).status,401);
  const offlineNewToken = await login('offlineadmin','offline-new-password');
  assert.equal(decode(offlineNewToken).sessionVersion,1);

  let newRealtime = spawnService('realtime', {
    ...env, PORT: String(realtimePort), PLATFORM_URL: platform,
    REALTIME_DATA_DIR: path.join(tmp, 'realtime'),
  });
  for (let i=0;i<30;i++) {
    try { if ((await fetch(`${realtime}/dev/token`)).status===405) break; }catch{}
    await sleep(120);
  }
  let synced = false;
  for (let n=0;n<60;n++) {
    if ((await rtAdminStatus(offlineOldToken))===401) { synced=true; break; }
    await sleep(150);
  }
  assert(synced,'Pending revocation was not synced after realtime restarted');
  assert.equal(await rtAdminStatus(offlineNewToken),200);
  console.log('PASS offline password reset is queued and automatically replayed after realtime recovery');

  const exitedAgain = new Promise(resolve=>newRealtime.once('exit',resolve));
  newRealtime.kill();
  await exitedAgain;
  newRealtime = spawnService('realtime', {
    ...env, PORT: String(realtimePort), PLATFORM_URL: platform,
    REALTIME_DATA_DIR: path.join(tmp, 'realtime'),
  });
  for (let i=0;i<30;i++) {
    try { if ((await fetch(`${realtime}/dev/token`)).status===405) break; }catch{}
    await sleep(120);
  }
  assert.equal(await rtAdminStatus(offlineOldToken),401);
  assert.equal(await rtAdminStatus(offlineNewToken),200);
  console.log('PASS revoked session versions survive realtime restart');
  console.log('SESSION VERSION TEST PASS');
}
main().catch(err=>{console.error('SESSION VERSION TEST FAIL',err);process.exitCode=1;})
.finally(async ()=>{
  for(const child of children) child.kill();
  await sleep(300);
  rmSync(tmp,{recursive:true,force:true});
});
