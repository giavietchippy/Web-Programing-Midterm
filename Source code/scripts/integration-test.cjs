'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const WebSocket=require(path.join(root,'realtime','node_modules','ws'));
const base=root;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'webrtc-member3-test-'));
const jwtSecret=crypto.randomBytes(32).toString('hex');
const internal=crypto.randomBytes(32).toString('hex');
const port=35000+Math.floor(Math.random()*5000), realtimePort=port+1;
let childP, childR;
const pause=(ms)=>new Promise(r=>setTimeout(r,ms));
async function waitHealthy(url){ for(let i=0;i<70;i++){try{ const res=await fetch(url);if(res.status<500)return;}catch{}await pause(120)}throw Error('not healthy '+url)}
async function http(path,token,method='GET',body){ const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});let b=null;try{b=await response.json()}catch{}return {status:response.status,body:b}; }
function wsConnect(token){ return new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${realtimePort}/ws?token=${encodeURIComponent(token)}`);ws.once('open',()=>resolve(ws));ws.once('error',reject)})}
function wsMessage(ws,check,timeout=2000){ return new Promise((resolve,reject)=>{let t;const f=(raw)=>{const m=JSON.parse(raw);if(check(m)){cleanup();resolve(m)}};const close=()=>{cleanup();reject(Error('closed before response'))};function cleanup(){clearTimeout(t);ws.off('message',f);ws.off('close',close)}ws.on('message',f);ws.on('close',close);t=setTimeout(()=>{cleanup();reject(Error('timeout waiting ws message'))},timeout)}) }
async function step(){
childP=spawn(process.execPath,['server.js'],{cwd:`${base}/platform`,env:{...process.env,PLATFORM_PORT:String(port),JWT_SECRET:jwtSecret,INTERNAL_API_KEY:internal,REALTIME_URL:`http://127.0.0.1:${realtimePort}`,ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'admin-test-password-123',NODE_ENV:'development',PLATFORM_DATA_DIR:path.join(tmp,'platform')},stdio:['ignore','pipe','pipe']});
childP.stderr.on('data',x=>process.stderr.write('PLATFORM: '+x));childP.stdout.on('data',x=>process.stdout.write('PLATFORM: '+x));
await waitHealthy(`http://127.0.0.1:${port}/health`);
childR=spawn(process.execPath,['server.js'],{cwd:`${base}/realtime`,env:{...process.env,PORT:String(realtimePort),JWT_SECRET:jwtSecret,INTERNAL_API_KEY:internal,PLATFORM_URL:`http://127.0.0.1:${port}`,NODE_ENV:'development',REALTIME_DATA_DIR:path.join(tmp,'realtime')},stdio:['ignore','pipe','pipe']});
childR.stderr.on('data',x=>process.stderr.write('REALTIME: '+x));childR.stdout.on('data',x=>process.stdout.write('REALTIME: '+x));
await waitHealthy(`http://127.0.0.1:${realtimePort}/dev/token`);
const adminLogin=await http('/api/login',null,'POST',{username:'admin',password:'admin-test-password-123'});assert.equal(adminLogin.status,200,JSON.stringify(adminLogin)); const admin=adminLogin.body.token;
assert.equal((await http('/api/register',null,'POST',{username:'alice',password:'alice-test-password'})).status,201);
const userLogin=await http('/api/login',null,'POST',{username:'alice',password:'alice-test-password'});assert.equal(userLogin.status,200);const user=userLogin.body.token;
const create=await http('/api/rooms',user,'POST',{name:'Study room'});assert.equal(create.status,201,JSON.stringify(create)); const roomId=create.body.room.id;
console.log('PASS register/login/create room');
const invalid=await wsConnect(user);const invalidMsg=wsMessage(invalid,m=>m.type==='error');invalid.send(JSON.stringify({type:'join',room:'nonexistent-room'}));assert.equal((await invalidMsg).code,'ROOM_NOT_FOUND');invalid.close();
const ws=await wsConnect(user); const joined=wsMessage(ws,m=>m.type==='joined');ws.send(JSON.stringify({type:'join',room:roomId})); assert.equal((await joined).room,roomId);
console.log('PASS room check valid/invalid');
ws.send(JSON.stringify({type:'chat',text:'Hello integration!'}));let hist;for(let i=0;i<25;i++){await pause(90);hist=await http(`/api/rooms/${roomId}/messages`,user); if(hist.body?.messages?.length)break;}assert.equal(hist.body.messages[0].text,'Hello integration!'); console.log('PASS persisted WebSocket chat');
const uid=userLogin.body.user.id;
const closed=new Promise((resolve,reject)=>{ws.on('close',(c)=>resolve(c));setTimeout(()=>reject(Error('close timeout')),3000)});
const blocked=await http(`/api/admin/users/${uid}`,admin,'PATCH',{disabled:true});assert.equal(blocked.status,200,JSON.stringify(blocked)); assert.equal(blocked.body.realtimeSync,true);assert.equal(await closed,4001);
const denied=await http('/api/me',user);assert.equal(denied.status,403);assert.equal(denied.body.error,'ACCOUNT_DISABLED');
const replay=await wsConnect(user); const rejected=wsMessage(replay,m=>m.type==='error');assert.equal((await rejected).code,'INVALID_TOKEN');
console.log('PASS user revoke/block and protected REST');
const unblock=await http(`/api/admin/users/${uid}`,admin,'PATCH',{disabled:false});assert.equal(unblock.status,200);
const roomWs=await wsConnect(admin);const j=wsMessage(roomWs,m=>m.type==='joined');roomWs.send(JSON.stringify({type:'join',room:roomId}));await j;
const roomClosed=wsMessage(roomWs,m=>m.type==='room-closed');const deleted=await http(`/api/rooms/${roomId}`,admin,'DELETE');assert.equal(deleted.status,204,JSON.stringify(deleted));await roomClosed;
const missing=await http(`/api/rooms/${roomId}`,admin);assert.equal(missing.status,404);
console.log('PASS close room when deleting');
const secretResp=await fetch(`http://127.0.0.1:${realtimePort}/internal/users/${uid}/revoke`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(secretResp.status,401);
console.log('PASS internal endpoint security');
const createdAdmin=await http('/api/admin/users',admin,'POST',{username:'moderator',password:'moderator-password-123',role:'admin'});
assert.equal(createdAdmin.status,201); const modId=createdAdmin.body.user.id;
const modLogin=await http('/api/login',null,'POST',{username:'moderator',password:'moderator-password-123'});
assert.equal(modLogin.status,200); const modToken=modLogin.body.token;
assert.equal((await fetch(`http://127.0.0.1:${realtimePort}/admin/stats`,{headers:{Authorization:`Bearer ${modToken}`}})).status,200);
const demote=await http(`/api/admin/users/${modId}`,admin,'PATCH',{role:'user'});
assert.equal(demote.status,200);assert.equal(demote.body.realtimeSync,true);
assert.equal((await fetch(`http://127.0.0.1:${realtimePort}/admin/stats`,{headers:{Authorization:`Bearer ${modToken}`}})).status,401);
await pause(1100);const modReLogin=await http('/api/login',null,'POST',{username:'moderator',password:'moderator-password-123'});
assert.equal(modReLogin.status,200);assert.equal(modReLogin.body.user.role,'user');
assert.equal((await fetch(`http://127.0.0.1:${realtimePort}/admin/stats`,{headers:{Authorization:`Bearer ${modReLogin.body.token}`}})).status,403);
console.log('PASS demotion invalidates stale Admin token');
roomWs.close();
}
step().then(()=>console.log('INTEGRATION PASS')).catch(e=>{console.error('INTEGRATION FAIL',e);process.exitCode=1;}).finally(()=>{childR?.kill();childP?.kill();setTimeout(()=>{try{fs.rmSync(tmp,{recursive:true,force:true})}catch{}},300);});
