'use strict';
require('node:fs'); // Standard Node.js only, no external npm packages required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function loadEnv(filename = path.join(__dirname, '.env')) {
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1]))
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv();
const PORT = Number(process.env.PLATFORM_PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const REALTIME_URL = process.env.REALTIME_URL || 'http://127.0.0.1:3001';
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_HOST = process.env.TURN_HOST || '';
const TURN_TTL = Number(process.env.TURN_TTL || 3600);
const DEV = process.env.NODE_ENV !== 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
// Only enable when an explicitly trusted proxy is the sole ingress to Platform.
// Nginx must overwrite, not append, X-Forwarded-For.
function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket.remoteAddress || 'unknown';
}
if (!JWT_SECRET || JWT_SECRET.length < 24 || !INTERNAL_API_KEY || INTERNAL_API_KEY.length < 24) {
  throw new Error('JWT_SECRET and INTERNAL_API_KEY must both be set and at least 24 characters long.');
}
if (JWT_SECRET === INTERNAL_API_KEY || (TURN_SECRET && (JWT_SECRET === TURN_SECRET || INTERNAL_API_KEY === TURN_SECRET))) {
  throw new Error('JWT_SECRET, INTERNAL_API_KEY, and TURN_SECRET must be different.');
}
const DATA_DIR = process.env.PLATFORM_DATA_DIR ? path.resolve(process.env.PLATFORM_DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'platform.sqlite'));
db.exec(`PRAGMA foreign_keys=ON;
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
    disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_by_id TEXT NOT NULL, created_by_username TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, username TEXT NOT NULL, text TEXT NOT NULL, ts TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id,seq);
  CREATE TABLE IF NOT EXISTS pending_revocations (
    user_id TEXT PRIMARY KEY, min_session_version INTEGER NOT NULL
  );
`);
// Migration is safe for both existing and newly created SQLite databases.
const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some(column => column.name === 'session_version')) {
  db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
}
const uuid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const utc = () => new Date().toISOString();
const text = (s) => typeof s === 'string' ? s : '';
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const validUsername = (s) => typeof s === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(s);
const validPassword = (s) => typeof s === 'string' && bytes(s) >= 8 && bytes(s) <= 72;
const publicUser = (u) => ({ id:u.id, username:u.username, role:u.role, disabled:!!u.disabled, createdAt:u.created_at });
const userRow = (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const findUser = (name) => db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(name);
const roomRow = (id) => db.prepare('SELECT * FROM rooms WHERE id=?').get(id);
const roomObj = (r) => ({ id:r.id, name:r.name, maxPeers:4, createdBy:{ id:r.created_by_id, username:r.created_by_username }, createdAt:r.created_at });
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}
function comparePassword(pw, stored) {
  const [algorithm, salt, hex] = (stored || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !hex || !/^[a-f\d]{128}$/i.test(hex)) return false;
  const real = Buffer.from(hex, 'hex');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, real.length), real);
}
function signJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg:'HS256', typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId:user.id, username:user.username, role:user.role, sessionVersion:user.session_version, iat:now, exp:now+3600 })).toString('base64url');
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function error(status, code, message, extra={}) { const e = new Error(message); Object.assign(e, { status, code, extra }); throw e; }
function parseJwt(token) {
  if (!token) error(401, 'INVALID_TOKEN', 'Bearer token required.');
  const parts = token.split('.');
  if (parts.length !== 3) error(401, 'INVALID_TOKEN', 'Invalid token.');
  let header, payload;
  try { header=JSON.parse(Buffer.from(parts[0], 'base64url')); payload=JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch { error(401, 'INVALID_TOKEN', 'Invalid token.'); }
  if (header.alg !== 'HS256' || !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || typeof payload.userId!=='string' || !Number.isSafeInteger(payload.sessionVersion) || payload.sessionVersion < 0)
    error(401,'INVALID_TOKEN','Invalid token.');
  const calculated=crypto.createHmac('sha256',JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  let signature;
  try { signature=Buffer.from(parts[2], 'base64url'); } catch { error(401,'INVALID_TOKEN','Invalid token.'); }
  if(signature.length!==calculated.length || !crypto.timingSafeEqual(signature,calculated)) error(401,'INVALID_TOKEN','Invalid token.');
  if (payload.exp <= Math.floor(Date.now()/1000)) error(401,'TOKEN_EXPIRED','JWT expired.');
  return payload;
}
function authorized(request, admin=false) {
  const match=(request.headers.authorization||'').match(/^Bearer\s+(.+)$/i);
  const claims=parseJwt(match?.[1]);
  const user=userRow(claims.userId);
  if(!user || user.username!==claims.username) error(401,'INVALID_TOKEN','Account no longer valid.');
  if(user.disabled) error(403,'ACCOUNT_DISABLED','Account is disabled.');
  if(claims.sessionVersion !== user.session_version) error(401,'INVALID_TOKEN','Session revoked. Log in again.');
  if(admin && user.role!=='admin') error(403,'FORBIDDEN','Admin role required.');
  return user;
}
function internalAuth(req) {
  const supplied=req.headers['x-internal-key'];
  const left=crypto.createHash('sha256').update(typeof supplied==='string'?supplied:'').digest();
  const right=crypto.createHash('sha256').update(INTERNAL_API_KEY).digest();
  if(typeof supplied!=='string' || !crypto.timingSafeEqual(left,right)) error(401,'UNAUTHORIZED','Internal key is invalid.');
}
const limits=new Map();
function rateLimit(key,max,ms) {
  const now=Date.now(); let entry=limits.get(key);
  if(!entry || now-entry.since>=ms) entry={since:now,n:0};
  limits.set(key,entry); entry.n++;
  if(limits.size>10000) for(const [k,v] of limits) if(now-v.since>ms) limits.delete(k);
  if(entry.n>max) error(429,'RATE_LIMITED','Too many requests.', {retryAfter:Math.ceil((ms-(now-entry.since))/1000)});
}
const send=(res, status, data, headers={}) => {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store', ...headers });
  res.end(status===204 ? undefined : JSON.stringify(data));
};
async function bodyJson(req) {
  const ct=(req.headers['content-type']||'').toLowerCase();
  if (!ct.startsWith('application/json')) error(415,'UNSUPPORTED_MEDIA_TYPE','Expected application/json.');
  let size=0, chunks=[];
  for await(const chunk of req) { size+=chunk.length; if(size>16*1024) error(413,'PAYLOAD_TOO_LARGE','Body cannot exceed 16 KB.'); chunks.push(chunk); }
  try { const result=JSON.parse(Buffer.concat(chunks).toString('utf8')); if(!result || typeof result!=='object' || Array.isArray(result)) throw Error(); return result; }
  catch { error(400,'VALIDATION_ERROR','Invalid JSON object.'); }
}
function makeUser(username,password,role='user') {
  const u={id:uuid('user'),username,password_hash:hashPassword(password),role,disabled:0,created_at:utc()};
  try{ db.prepare('INSERT INTO users (id,username,password_hash,role,disabled,created_at) VALUES (?,?,?,?,?,?)').run(u.id,u.username,u.password_hash,u.role,0,u.created_at); }
  catch(e){ if(String(e).includes('UNIQUE')) error(409,'USERNAME_TAKEN','Username is taken.'); throw e; }
  return u;
}
if(!db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()) {
  const name=process.env.ADMIN_USERNAME, password=process.env.ADMIN_PASSWORD;
  if(!validUsername(name) || !validPassword(password)) throw new Error('Set ADMIN_USERNAME (3-32 valid characters) and ADMIN_PASSWORD (8-72 bytes) in platform/.env.');
  const admin=makeUser(name,password,'admin'); console.log(`Seed admin created: ${admin.username}`);
}
async function callRealtime(endpoint, data) {
  let result;
  try {
    const response=await fetch(new URL(endpoint, REALTIME_URL), {
      method:'POST', headers:{'Content-Type':'application/json','X-Internal-Key':INTERNAL_API_KEY},
      body:JSON.stringify(data||{}), signal:AbortSignal.timeout(3000),
    });
    if(!response.ok) throw Error(`HTTP ${response.status}`);
    result=await response.json();
  } catch(e) { console.error('Real-time internal API unavailable:',e.message); error(502,'REALTIME_UNAVAILABLE','Real-time service is unavailable.'); }
  return result;
}
// Persistent outbox: retry realtime revokes after outages/restarts.
function queueRevoke(id, minSessionVersion) {
  db.prepare(`INSERT INTO pending_revocations (user_id, min_session_version)
    VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET
    min_session_version=MAX(min_session_version, excluded.min_session_version)`)
    .run(id, minSessionVersion);
}
async function syncRevoke(id) {
  const row = db.prepare('SELECT * FROM pending_revocations WHERE user_id=?').get(id);
  if (!row) return true;
  try {
    await callRealtime(`/internal/users/${encodeURIComponent(id)}/revoke`,
      { minSessionVersion: row.min_session_version });
    // Never remove an event queued concurrently with a newer version.
    db.prepare('DELETE FROM pending_revocations WHERE user_id=? AND min_session_version<=?')
      .run(id, row.min_session_version);
    return true;
  } catch { return false; }
}
let revokeSyncRunning = false;
async function retryPendingRevocations() {
  if (revokeSyncRunning) return;
  revokeSyncRunning = true;
  try {
    for (const { user_id } of db.prepare('SELECT user_id FROM pending_revocations').all())
      await syncRevoke(user_id);
  } finally { revokeSyncRunning = false; }
}
const revokeRetryTimer = setInterval(() => {
  void retryPendingRevocations().catch(e => console.error('Revoke retry failed:', e.message));
}, 5000);
revokeRetryTimer.unref();

function decodeId(value) { try { return decodeURIComponent(value); } catch { error(400,'VALIDATION_ERROR','Invalid identifier.'); } }
async function handle(req,res) {
  const url=new URL(req.url,`http://${req.headers.host || 'localhost'}`);
  const p=url.pathname, method=req.method;
  if(p==='/health' && method==='GET') return send(res,200,{ok:true,service:'platform'});
  if(p==='/api/register' && method==='POST') {
    rateLimit(`auth:${clientIp(req)}`,10,60000);
    const b=await bodyJson(req);
    if(!validUsername(b.username)||!validPassword(b.password)) error(400,'VALIDATION_ERROR','Username or password is invalid.');
    const u=makeUser(b.username,b.password);
    return send(res,201,{user:{id:u.id,username:u.username,role:u.role,createdAt:u.created_at}});
  }
  if(p==='/api/login' && method==='POST') {
    rateLimit(`auth:${clientIp(req)}`,10,60000);
    const b=await bodyJson(req);
    if(typeof b.username!=='string'||typeof b.password!=='string') error(400,'VALIDATION_ERROR','Username and password required.');
    const u=findUser(b.username);
    // Avoid using early return before verifying against a real hash, limiting timing differences.
    if (!u || !comparePassword(b.password,u.password_hash)) error(401,'INVALID_CREDENTIALS','Invalid username or password.');
    if(u.disabled) error(403,'ACCOUNT_DISABLED','Account is disabled.');
    return send(res,200,{token:signJwt(u),tokenType:'Bearer',expiresIn:3600,user:{id:u.id,username:u.username,role:u.role}});
  }
  if(p.startsWith('/internal/')) internalAuth(req);
  let user=null;
  if(p.startsWith('/api/')) {
    const isAdmin=p.startsWith('/api/admin/'); user=authorized(req,isAdmin);
    rateLimit(`api:${user.id}`,120,60000);
  }
  if(p==='/api/me' && method==='GET') return send(res,200,{user:{id:user.id,username:user.username,role:user.role}});
  if(p==='/api/rooms' && method==='GET') return send(res,200,{rooms:db.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all().map(roomObj)});
  if(p==='/api/rooms' && method==='POST') {
    const b=await bodyJson(req); const name=text(b.name).trim();
    if(!name||name.length>64) error(400,'VALIDATION_ERROR','Room name must be 1 to 64 characters.');
    if(db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count>=100) error(409,'ROOM_LIMIT_REACHED','Maximum 100 rooms.');
    const room={id:uuid('room'),name,created_by_id:user.id,created_by_username:user.username,created_at:utc()};
    try{db.prepare('INSERT INTO rooms (id,name,created_by_id,created_by_username,created_at) VALUES (?,?,?,?,?)').run(room.id,name,user.id,user.username,room.created_at);}
    catch(e){ if(String(e).includes('UNIQUE')) error(409,'ROOM_NAME_TAKEN','Room name taken.'); throw e; }
    return send(res,201,{room:roomObj(room)},{Location:`/api/rooms/${room.id}`});
  }
  let m;
  if((m=p.match(/^\/api\/rooms\/([^/]+)$/))) {
    const id=decodeId(m[1]), room=roomRow(id);
    if(!room) error(404,'ROOM_NOT_FOUND','Room does not exist.');
    if(method==='GET') return send(res,200,{room:roomObj(room)});
    if(method==='DELETE') {
      if(user.id!==room.created_by_id && user.role!=='admin') error(403,'FORBIDDEN','Creator or admin required.');
      await callRealtime(`/internal/rooms/${encodeURIComponent(id)}/close`,{reason:'Room deleted'});
      db.prepare('DELETE FROM rooms WHERE id=?').run(id);
      return send(res,204);
    }
  }
  if((m=p.match(/^\/api\/rooms\/([^/]+)\/join$/)) && method==='POST') {
    const room=roomRow(decodeId(m[1]));
    if(!room) error(404,'ROOM_NOT_FOUND','Room does not exist.');
    return send(res,200,{room:roomObj(room)});
  }
  if((m=p.match(/^\/api\/rooms\/([^/]+)\/messages$/)) && method==='GET') {
    const id=decodeId(m[1]); if(!roomRow(id)) error(404,'ROOM_NOT_FOUND','Room does not exist.');
    const limit=url.searchParams.has('limit')?Number(url.searchParams.get('limit')):50;
    if(!Number.isInteger(limit)||limit<1||limit>100) error(400,'VALIDATION_ERROR','Invalid limit.');
    const before=url.searchParams.get('before'); let upper=Number.MAX_SAFE_INTEGER;
    if(before){ const prior=db.prepare('SELECT seq FROM messages WHERE id=? AND room_id=?').get(before,id);
      if(!prior) error(400,'VALIDATION_ERROR','Invalid before cursor.'); upper=prior.seq; }
    const rows=db.prepare('SELECT * FROM messages WHERE room_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(id,upper,limit+1);
    const hasMore=rows.length>limit; const current=rows.slice(0,limit).reverse();
    return send(res,200,{messages:current.map(x=>({id:x.id,roomId:x.room_id,userId:x.user_id,username:x.username,text:x.text,ts:x.ts})),hasMore,nextBefore:hasMore?current[0].id:null});
  }
  if(p==='/api/config/ice' && method==='GET') {
    const ttl=Number.isInteger(TURN_TTL)&&TURN_TTL>0?TURN_TTL:3600;
    const exp=Math.floor(Date.now()/1000)+ttl;
    const iceServers=[{urls:'stun:stun.l.google.com:19302'}];
    if(TURN_HOST) iceServers.push({urls:`stun:${TURN_HOST}:3478`});
    if(TURN_HOST&&TURN_SECRET) {
      const username=`${exp}:${user.id}`;
      // Coturn is configured without TLS by default. Only advertise turns: after
      // deploying a valid TURN TLS certificate and enabling TURN_TLS_ENABLED.
      const urls=[`turn:${TURN_HOST}:3478?transport=udp`,`turn:${TURN_HOST}:3478?transport=tcp`];
      if(process.env.TURN_TLS_ENABLED==='true') urls.push(`turns:${TURN_HOST}:5349?transport=tcp`);
      iceServers.push({urls,username,credential:crypto.createHmac('sha1',TURN_SECRET).update(username).digest('base64')});
    } else if(!DEV) error(503,'TURN_NOT_CONFIGURED','TURN is not configured.');
    return send(res,200,{iceServers,ttl,expiresAt:new Date(exp*1000).toISOString()});
  }
  if(p==='/api/admin/stats' && method==='GET') return send(res,200,{users:{total:db.prepare('SELECT COUNT(*) AS n FROM users').get().n},rooms:{total:db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n},messages:{total:db.prepare('SELECT COUNT(*) AS n FROM messages').get().n},realtime:null,generatedAt:utc()});
  if(p==='/api/admin/users' && method==='GET') {
    const search=text(url.searchParams.get('search')).toLowerCase(), role=url.searchParams.get('role');
    if(role && !['user','admin'].includes(role)) error(400,'VALIDATION_ERROR','Invalid role filter.');
    const users=db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().filter(u=>(!role||u.role===role)&&(!search||u.username.toLowerCase().includes(search)||u.id.toLowerCase().includes(search))).map(publicUser);
    return send(res,200,{users});
  }
  if(p==='/api/admin/users' && method==='POST') {
    const b=await bodyJson(req);
    if(!validUsername(b.username)||!validPassword(b.password)||!['user','admin'].includes(b.role)) error(400,'VALIDATION_ERROR','Invalid new user fields.');
    return send(res,201,{user:publicUser(makeUser(b.username,b.password,b.role))});
  }
  if((m=p.match(/^\/api\/admin\/users\/([^/]+)$/))) {
    const id=decodeId(m[1]); const target=userRow(id);
    if(!target) error(404,'USER_NOT_FOUND','User not found.');
    if(method==='PATCH') {
      const b=await bodyJson(req);
      if(Object.hasOwn(b,'role')&&!['user','admin'].includes(b.role)) error(400,'VALIDATION_ERROR','Invalid role.');
      if(Object.hasOwn(b,'disabled')&&typeof b.disabled!=='boolean') error(400,'VALIDATION_ERROR','disabled must be boolean.');
      if(id===user.id && (b.disabled===true || (b.role!==undefined&&b.role!=='admin'))) error(403,'FORBIDDEN','Cannot disable/demote yourself.');
      const role=b.role??target.role, disabled=b.disabled===undefined?target.disabled:Number(b.disabled);
      const changed = role !== target.role || disabled !== target.disabled;
      // A new version invalidates all JWTs from before the change, even in the same second.
      // Repeating an identical PATCH does not bump again, and is safe for retrying realtime sync.
      const sessionVersion = target.session_version + (changed ? 1 : 0);
      const shouldRevoke = Object.hasOwn(b,'role') || b.disabled===true;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE users SET role=?, disabled=?, session_version=? WHERE id=?')
          .run(role,disabled,sessionVersion,id);
        if (shouldRevoke) queueRevoke(id,sessionVersion);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      const synced = shouldRevoke ? await syncRevoke(id) : true;
      return send(res,200,{user:publicUser(userRow(id)),realtimeSync:synced});
    }
    if(method==='DELETE') {
      if(id===user.id) error(403,'FORBIDDEN','Cannot delete yourself.');
      await callRealtime(`/internal/users/${encodeURIComponent(id)}/revoke`,
        { minSessionVersion: target.session_version + 1 });
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      db.prepare('DELETE FROM pending_revocations WHERE user_id=?').run(id);
      return send(res,204);
    }
  }
  if((m=p.match(/^\/api\/admin\/users\/([^/]+)\/password$/)) && method==='POST') {
    const id=decodeId(m[1]); if(!userRow(id)) error(404,'USER_NOT_FOUND','User not found.');
    const b=await bodyJson(req); if(!validPassword(b.password)) error(400,'VALIDATION_ERROR','Password must be 8-72 bytes.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_hash=?, session_version=session_version+1 WHERE id=?')
        .run(hashPassword(b.password),id);
      queueRevoke(id, userRow(id).session_version);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    // Kept as 204 for contract compatibility; queued revocation is retried in background.
    if (!(await syncRevoke(id)))
      console.warn(`Password reset for ${id}: realtime revoke queued until connection recovers.`);
    return send(res,204);
  }
  if((m=p.match(/^\/internal\/rooms\/([^/]+)$/)) && method==='GET') {
    const r=roomRow(decodeId(m[1])); if(!r) error(404,'ROOM_NOT_FOUND','Room does not exist.');
    return send(res,200,{room:roomObj(r)});
  }
  if((m=p.match(/^\/internal\/rooms\/([^/]+)\/messages$/)) && method==='POST') {
    const id=decodeId(m[1]); if(!roomRow(id)) error(404,'ROOM_NOT_FOUND','Room does not exist.');
    const b=await bodyJson(req);
    if(!userRow(b.userId)||typeof b.username!=='string'||b.username.length>32||typeof b.text!=='string'||b.text.length<1||b.text.length>2000||isNaN(Date.parse(b.ts)))
      error(400,'VALIDATION_ERROR','Invalid message.');
    const idMsg=uuid('msg');
    db.prepare('INSERT INTO messages (id,room_id,user_id,username,text,ts) VALUES (?,?,?,?,?,?)').run(idMsg,id,b.userId,b.username,b.text,b.ts);
    return send(res,201,{id:idMsg});
  }
  // Existing routes with an unsupported method follow the contract's 405 + Allow rule.
  const fixed = {
    '/health':['GET'], '/api/register':['POST'], '/api/login':['POST'], '/api/me':['GET'],
    '/api/rooms':['GET','POST'], '/api/config/ice':['GET'], '/api/admin/stats':['GET'],
    '/api/admin/users':['GET','POST'],
  };
  let allowed=fixed[p];
  if(!allowed && /^\/api\/rooms\/[^/]+$/.test(p)) allowed=['GET','DELETE'];
  if(!allowed && /^\/api\/rooms\/[^/]+\/join$/.test(p)) allowed=['POST'];
  if(!allowed && /^\/api\/rooms\/[^/]+\/messages$/.test(p)) allowed=['GET'];
  if(!allowed && /^\/api\/admin\/users\/[^/]+$/.test(p)) allowed=['PATCH','DELETE'];
  if(!allowed && /^\/api\/admin\/users\/[^/]+\/password$/.test(p)) allowed=['POST'];
  if(!allowed && /^\/internal\/rooms\/[^/]+$/.test(p)) allowed=['GET'];
  if(!allowed && /^\/internal\/rooms\/[^/]+\/messages$/.test(p)) allowed=['POST'];
  if(allowed) error(405,'METHOD_NOT_ALLOWED','Method not allowed.',{allow:allowed.join(', ')});
  error(404,'NOT_FOUND','Endpoint not found.');
}
const server=http.createServer((req,res)=>{ handle(req,res).catch(e=>{
  const status=e.status||500; if(status===500) console.error('Platform error:',e);
  if(res.headersSent) {res.destroy();return;}
  const headers={...(e.extra?.retryAfter?{'Retry-After':String(e.extra.retryAfter)}:{}),...(e.extra?.allow?{'Allow':e.extra.allow}:{})};
  send(res,status,{error:e.code||'INTERNAL_ERROR',message:status===500?'Internal server error.':e.message},headers);
}); });
if(require.main===module) server.listen(PORT,()=>{
  console.log(`Platform REST listening on http://localhost:${PORT}`);
  void retryPendingRevocations().catch(e => console.error('Initial revoke sync failed:', e.message));
});
module.exports={server,db};
