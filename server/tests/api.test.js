import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'cadence-api-')); process.env.CADENCE_DIR=dir;
const {createApiServer,listen}=await import('../src/api.js');
const {ownerToken,agentToken}=await import('../src/auth.js');
const {db}=await import('../src/db.js');
const server=createApiServer(); const address=await listen(server,0); const base=`http://127.0.0.1:${address.port}`;
test.after(async()=> {await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});});
async function request(path,{token=ownerToken,method='GET',body,headers={}}={}) {return fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});}
test('API requires credentials and rejects browser origins',async()=> {
 assert.equal((await request('/api/brands',{token:'wrong'})).status,401);
 assert.equal((await request('/api/brands',{headers:{Origin:'https://attacker.example'}})).status,403);
 const status=await new Promise((resolve,reject)=> { const req=httpRequest(base+'/api/brands',{headers:{Host:'attacker.example',Authorization:`Bearer ${ownerToken}`}},res=> {res.resume();resolve(res.statusCode);}); req.on('error',reject);req.end(); });
 assert.equal(status,403);
});
test('agent can draft but cannot approve or store credentials',async()=> {
 const brand=await (await request('/api/brands',{method:'POST',body:{name:'Test brand',url:'https://example.com'}})).json();
 const response=await request('/api/posts',{token:agentToken,method:'POST',body:{brand_id:brand.id,platforms:['mastodon'],copy:{mastodon:'Hello from a draft'},scheduled_at:new Date(Date.now()+3600000).toISOString()}});
 assert.equal(response.status,201); const post=await response.json(); assert.equal(post.status,'draft');
 assert.equal((await request(`/api/posts/${post.id}/approve`,{token:agentToken,method:'POST',body:{version:1,actor:'owner'}})).status,403);
 assert.equal((await request('/api/accounts',{token:agentToken,method:'POST',body:{}})).status,403);
 assert.equal((await request(`/api/posts/${post.id}/approve`,{method:'POST',body:{version:1}})).status,200);
});
