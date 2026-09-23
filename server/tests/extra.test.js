import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'cadence-extra-')); process.env.CADENCE_DIR = dir;
const { createApiServer, listen } = await import('../src/api.js');
const { ownerToken, agentToken } = await import('../src/auth.js');
const { db, insert, encrypt, all } = await import('../src/db.js');
const { autoApproveDue } = await import('../src/autonomy.js');
await import('../src/brands.js');
const server = createApiServer(); const address = await listen(server, 0); const base = `http://127.0.0.1:${address.port}`;
test.after(async () => { await new Promise((r) => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }); });
const req = (path, { token = ownerToken, method = 'GET', body } = {}) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const future = () => new Date(Date.now() + 3600e3).toISOString();

test('pasting only a URL creates a brand and queues extraction', async () => {
  const r = await req('/api/brands', { method: 'POST', body: { url: 'https://acme-widgets.example/pricing?x=1' } });
  assert.equal(r.status, 202); const b = await r.json();
  assert.equal(b.name, 'acme-widgets.example'); assert.equal(b.status, 'extracting');
  assert.equal(all("SELECT * FROM jobs WHERE type = 'brand-extract' AND ref_id = ?", b.id).length, 1);
  assert.equal((await req('/api/brands', { method: 'POST', body: { url: 'https://acme-widgets.example/other' } })).status, 200);
});
test('settings are owner-only and autonomy is validated', async () => {
  assert.equal((await req('/api/settings', { token: agentToken, method: 'PUT', body: { autonomy: 'hands_off' } })).status, 403);
  assert.equal((await req('/api/settings', { method: 'PUT', body: { autonomy: 'yolo' } })).status, 400);
  assert.equal((await req('/api/settings', { method: 'PUT', body: { webhook_url: 'http://evil.example/x' } })).status, 400);
  assert.equal((await req('/api/settings', { method: 'PUT', body: { autonomy: 'auto_trusted' } })).status, 200);
  assert.equal((await (await req('/api/settings')).json()).autonomy, 'auto_trusted');
});
test('approve-and-schedule defaults to connected accounts; comments record feedback', async () => {
  const brand = await (await req('/api/brands', { method: 'POST', body: { name: 'B', url: 'https://b.example' } })).json();
  const acc = insert('accounts', { brand_id: brand.id, platform: 'mock', label: 'Mock', auth_enc: encrypt({}) });
  const post = await (await req('/api/posts', { token: agentToken, method: 'POST', body: { brand_id: brand.id, platforms: ['mock'], copy: { mock: 'hi' }, scheduled_at: future() } })).json();
  const c = await req(`/api/posts/${post.id}/comments`, { token: agentToken, method: 'POST', body: { body: 'needs a stronger hook' } });
  assert.equal(c.status, 201); assert.equal((await (await req(`/api/posts/${post.id}/comments`)).json()).length, 1);
  assert.equal((await req(`/api/posts/${post.id}/approve-and-schedule`, { token: agentToken, method: 'POST', body: { version: 1 } })).status, 403);
  const s = await (await req(`/api/posts/${post.id}/approve-and-schedule`, { method: 'POST', body: { version: 1 } })).json();
  assert.equal(s.status, 'scheduled');
  assert.equal(all('SELECT * FROM deliveries WHERE post_id = ?', post.id)[0].account_id, acc);
});
test('autonomy auto_trusted only schedules to trusted accounts', async () => {
  const brand = await (await req('/api/brands', { method: 'POST', body: { name: 'C', url: 'https://c.example' } })).json();
  const acc = insert('accounts', { brand_id: brand.id, platform: 'mock', label: 'Mock', auth_enc: encrypt({}) });
  const mk = async () => (await (await req('/api/posts', { token: agentToken, method: 'POST', body: { brand_id: brand.id, platforms: ['mock'], copy: { mock: 'auto' }, scheduled_at: future(), format: 'text' } })).json()).id;
  const p1 = await mk();
  assert.equal(autoApproveDue(), 0);
  assert.equal((await req(`/api/accounts/${acc}`, { method: 'PATCH', body: { trusted: true } })).status, 200);
  assert.equal(autoApproveDue(), 1);
  const post = await (await req(`/api/posts?brand_id=${brand.id}`)).json();
  assert.equal(post.find((p) => p.id === p1).approved_by, 'autonomy:auto_trusted');
  await req('/api/settings', { method: 'PUT', body: { autonomy: 'review_all' } });
  await mk(); assert.equal(autoApproveDue(), 0);
});
test('asset route refuses paths outside the app dirs', async () => {
  assert.equal((await req('/api/assets?path=/etc/passwd')).status, 404);
  assert.equal((await req(`/api/assets?path=${encodeURIComponent(join(dir, 'brands/../../etc/passwd'))}`)).status, 404);
  symlinkSync('/etc/passwd',join(dir,'brands/leaked.txt'));
  assert.equal((await req(`/api/assets?path=${encodeURIComponent(join(dir,'brands/leaked.txt'))}`)).status,404);
});
test('manual account returns the complete native client model',async()=>{
 const brand=await(await req('/api/brands',{method:'POST',body:{name:'Manual',url:'https://manual.example'}})).json();
 const r=await req('/api/accounts/manual',{method:'POST',body:{brand_id:brand.id,platform:'mock',fields:{}}});
 assert.equal(r.status,201);const account=await r.json();
 assert.equal(account.brand_id,brand.id);assert.equal(account.paused,0);assert.equal(account.trusted,0);assert.equal(account.auth_enc,undefined);
});
test('publish now queues approved content and never references missing delivery columns',async()=>{
 const brand=await(await req('/api/brands',{method:'POST',body:{name:'Publish',url:'https://publish.example'}})).json();
 insert('accounts',{brand_id:brand.id,platform:'mock',label:'Dry run',auth_enc:encrypt({})});
 const post=await(await req('/api/posts',{method:'POST',body:{brand_id:brand.id,platforms:['mock'],copy:{mock:'Ready'},scheduled_at:future(),format:'text'}})).json();
 assert.equal((await req(`/api/posts/${post.id}/publish-now`,{method:'POST',body:{}})).status,409);
 await req(`/api/posts/${post.id}/approve`,{method:'POST',body:{version:1}});
 const response=await req(`/api/posts/${post.id}/publish-now`,{method:'POST',body:{}});
 assert.equal(response.status,200);const ready=await response.json();assert.equal(ready.status,'scheduled');assert.ok(Date.parse(ready.scheduled_at)<=Date.now());
 assert.equal(all('SELECT * FROM deliveries WHERE post_id=?',post.id).length,1);
});
test('settings reject partial invalid changes and never reveal secrets to agent role',async()=>{
 const before=await(await req('/api/settings')).json();
 assert.equal((await req('/api/settings',{method:'PUT',body:{autonomy:'hands_off',cap_per_account_per_day:'-1'}})).status,400);
 assert.equal((await(await req('/api/settings')).json()).autonomy,before.autonomy);
 assert.equal((await req('/api/settings',{token:agentToken})).status,403);
});

test('a handler that reports a bad progress value still completes', async () => {
  const { registerJob, enqueue, workOne } = await import('../src/jobs.js');
  const { one } = await import('../src/db.js');
  registerJob('progress-probe', async (_ref, report) => { report('R1 · FAIL'); });
  const job = enqueue('progress-probe', 'probe-ref');
  for (let i = 0; i < 20 && one('SELECT status FROM jobs WHERE id = ?', job.id).status === 'queued'; i++) await workOne();
  const done = one('SELECT * FROM jobs WHERE id = ?', job.id);
  assert.equal(done.status, 'complete');
  assert.equal(done.message, 'Complete');
});

test('readiness reports an image gateway that is out of quota instead of calling it ready',async()=> {
 const {readiness}=await import('../src/readiness.js');
 const reply=body=>async()=>({ok:true,json:async()=>body});
 const img=async fetchImpl=>(await readiness({fetchImpl})).checks.find(c=>c.id==='images');
 const limited=await img(reply({can_generate_image:false,retry_after_seconds:50400}));
 assert.equal(limited.ready,false);assert.match(limited.message,/out of image quota for about 14h/);
 assert.equal((await img(reply({can_generate_image:true}))).ready,true);
 assert.equal((await img(async()=>{throw new Error('down');})).ready,false);
});
