// Run from "Source code": node scripts/turn-config-test.cjs
// Isolated Platform only: verifies REST TURN credentials, no TLS URL by default.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

function freePort() { return new Promise((ok,fail) => { const s=net.createServer(); s.on('error',fail); s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>ok(n));}); }); }
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'webrtc-turn-config-'));
 const port=await freePort();
 const secret=crypto.randomBytes(32).toString('hex');
 const child=spawn(process.execPath,['server.js'],{
  cwd:path.resolve(__dirname,'../platform'),
  env:{ ...process.env, PLATFORM_PORT:String(port), PLATFORM_DATA_DIR:tmp,
    JWT_SECRET:crypto.randomBytes(32).toString('hex'), INTERNAL_API_KEY:crypto.randomBytes(32).toString('hex'),
    TURN_SECRET:secret,TURN_HOST:'turn.example.invalid',TURN_TLS_ENABLED:'false',
    ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'temporary-admin-password',NODE_ENV:'production'},
  stdio:'pipe',
 });
 let stderr='';child.stderr.on('data',x=>stderr+=x);
 try{
  const base=`http://127.0.0.1:${port}`;
  let alive=false;
  for(let i=0;i<80;i++){try{const r=await fetch(`${base}/health`);if(r.ok){alive=true;break;}}catch{}await sleep(100)}
  assert(alive,`Platform failed to start: ${stderr}`);
  const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'temporary-admin-password'})});
  assert.equal(login.status,200);
  const token=(await login.json()).token;
  const response=await fetch(`${base}/api/config/ice`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.iceServers.length,2);
  const turns=data.iceServers[1];
  assert.deepEqual(turns.urls,['turn:turn.example.invalid:3478?transport=udp','turn:turn.example.invalid:3478?transport=tcp']);
  assert(!turns.urls.some(x=>x.startsWith('turns:')),'TLS url must not be advertised without a TLS cert');
  assert.match(turns.username,/^\d+:user-/);
  const expected=crypto.createHmac('sha1',secret).update(turns.username).digest('base64');
  assert.equal(turns.credential,expected);
  assert(data.ttl>0 && Date.parse(data.expiresAt)>Date.now());
  console.log('PASS TURN REST credentials HMAC-SHA1');
  console.log('PASS non-TLS TURN UDP/TCP URLs only');
  console.log('PASS short-lived TURN username + expiry');
  console.log('TURN CONFIG TEST PASS (does not test actual coturn network relay)');
 }finally{
  child.kill();
  await sleep(250);
  try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}
 }
}
run().catch(e=>{console.error(e);process.exitCode=1});
