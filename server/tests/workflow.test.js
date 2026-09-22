import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'cadence-test-'));
process.env.CADENCE_DIR = dir;
const { db, insert, encrypt, run, one, setSetting } = await import('../src/db.js');
const { createPost, editPost, approvePost, schedulePost, postById } = await import('../src/workflow.js');
const { tick, recoverInterruptedDeliveries } = await import('../src/scheduler.js');
test.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const brand = insert('brands', { slug: 'test', name: 'Test', url: 'https://example.com', dir });
const account = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'Test', auth_enc: encrypt({ token: 'test-only' }) });
function draft() { return createPost({ brand_id: brand, platforms: ['mastodon'], copy: { mastodon: 'A considered post.' }, scheduled_at: new Date(Date.now() + 3600000).toISOString() }); }
function scheduled() { const p = draft(); approvePost(p.id, 1, 'owner'); schedulePost(p.id, 1, [account]); run('UPDATE posts SET scheduled_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), p.id); return p; }
test('agent cannot bypass approval, and stale edits are rejected', () => {
 const p = draft(); assert.throws(() => approvePost(p.id, 1, 'agent'), /Human/);
 assert.throws(() => schedulePost(p.id, 1, [account]), /Approve/);
 approvePost(p.id, 1, 'owner'); const edited = editPost(p.id, { copy: { mastodon: 'Changed caption' } }, 1);
 assert.equal(edited.status, 'draft'); assert.equal(edited.approved_by, null);
 assert.throws(() => approvePost(p.id, 1, 'owner'), /changed/);
});
test('scheduler publishes exactly once across concurrent ticks', async () => {
 const p = scheduled(); let sends = 0;
 const opts = { getProvider: () => ({ publish: async () => { sends++; await new Promise(r => setTimeout(r, 10)); return { id: 'remote-1' }; } }) };
 await Promise.all([tick(opts), tick(opts)]); assert.equal(sends, 1); assert.equal(postById(p.id).status, 'published');
 await tick(opts); assert.equal(sends, 1);
});
test('editing a scheduled post invalidates its queued deliveries', async () => {
 const p = scheduled(); editPost(p.id, { copy: { mastodon: 'Needs another review' } }, 1);
 let sends = 0; await tick({ getProvider: () => ({ publish: async () => { sends++; return { id: 'bad' }; } }) }); assert.equal(sends, 0);
});
test('ambiguous timeout never retries automatically', async () => {
 const p = scheduled(); let sends = 0;
 const opts = { getProvider: () => ({ publish: async () => { sends++; throw new Error('Timed out after remote accepted request'); } }) };
 await tick(opts); await tick(opts); assert.equal(sends, 1); assert.equal(postById(p.id).status, 'uncertain');
});
test('restart marks in-flight sends uncertain', () => {
 const p = scheduled(); run("UPDATE deliveries SET status='sending' WHERE post_id=?", p.id); run("UPDATE posts SET status='publishing' WHERE id=?", p.id);
 recoverInterruptedDeliveries(); assert.equal(postById(p.id).status, 'uncertain'); assert.equal(one('SELECT status FROM deliveries WHERE post_id=?', p.id).status, 'uncertain');
});
test('destinations are isolated by brand', () => {
 const b = insert('brands', { slug:'other', name:'Other', url:'https://example.org', dir });
 const a = insert('accounts', { brand_id:b, platform:'mastodon', label:'Other', auth_enc:encrypt({}) });
 const p = draft(); approvePost(p.id,1,'owner'); assert.throws(() => schedulePost(p.id,1,[a]), /different brand/);
});
test('daily account cap is enforced across concurrent scheduler ticks',async()=>{
 const fresh=insert('accounts',{brand_id:brand,platform:'mastodon',label:'Capped',auth_enc:encrypt({})});
 const posts=[draft(),draft()];
 for(const p of posts){approvePost(p.id,1,'owner');schedulePost(p.id,1,[fresh]);run('UPDATE posts SET scheduled_at=? WHERE id=?',new Date(Date.now()-1000).toISOString(),p.id);}
 setSetting('cap_per_account_per_day','1');let sends=0;
 try {
  const options={getProvider:()=>({publish:async()=>{sends++;await new Promise(r=>setTimeout(r,10));return {id:'capped'};}})};
  await Promise.all([tick(options),tick(options)]);assert.equal(sends,1);
  assert.equal(posts.filter(p=>postById(p.id).status==='scheduled').length,1);
 }finally{setSetting('cap_per_account_per_day','');}
});
