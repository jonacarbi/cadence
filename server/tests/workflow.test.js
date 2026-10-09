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
setSetting('min_gap_minutes', '0'); setSetting('warmup', 'off'); // these tests publish many times from one account; safety.test.js covers the limits
const brand = insert('brands', { slug: 'test', name: 'Test', url: 'https://example.com', dir });
const account = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'Test', auth_enc: encrypt({ token: 'test-only' }) });
function draft() { return createPost({ brand_id: brand, platforms: ['mastodon'], copy: { mastodon: 'A considered post.' }, scheduled_at: new Date(Date.now() + 3600000).toISOString() }); }
function scheduled() { const p = draft(); approvePost(p.id, 1, 'owner'); schedulePost(p.id, 1, [account]); run('UPDATE posts SET scheduled_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), p.id); run('UPDATE deliveries SET next_attempt_at = NULL WHERE post_id = ?', p.id); return p; }
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
 for(const p of posts){approvePost(p.id,1,'owner');schedulePost(p.id,1,[fresh]);run('UPDATE posts SET scheduled_at=? WHERE id=?',new Date(Date.now()-1000).toISOString(),p.id);run('UPDATE deliveries SET next_attempt_at=NULL WHERE post_id=?',p.id);}
 setSetting('cap_per_account_per_day','1');let sends=0;
 try {
  const options={getProvider:()=>({publish:async()=>{sends++;await new Promise(r=>setTimeout(r,10));return {id:'capped'};}})};
  await Promise.all([tick(options),tick(options)]);assert.equal(sends,1);
  assert.equal(posts.filter(p=>postById(p.id).status==='scheduled').length,1);
 }finally{setSetting('cap_per_account_per_day','');}
});
const due = (brandId, acct) => { const p = createPost({ brand_id: brandId, platforms: ['mastodon'], copy: { mastodon: 'A considered post.' }, scheduled_at: new Date(Date.now() + 3600000).toISOString() }); approvePost(p.id, 1, 'owner'); schedulePost(p.id, 1, [acct]); run('UPDATE posts SET scheduled_at=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), p.id); run('UPDATE deliveries SET next_attempt_at=NULL WHERE post_id=?', p.id); return p; };
const counting = (ids, impl) => { const sends = []; return { sends, getProvider: () => ({ publish: async ({ account: a }) => { if (!ids.includes(a.id)) return { id: 'other' }; sends.push(a.id); return impl(a); } }) }; };
test('the daily cap follows the remote account, even when it is connected under two brands', async () => {
 const b2 = insert('brands', { slug: 'twin', name: 'Twin', url: 'https://example.net', dir });
 const a1 = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'Same', external_id: 'remote-42', auth_enc: encrypt({}) });
 const a2 = insert('accounts', { brand_id: b2, platform: 'mastodon', label: 'Same', external_id: 'remote-42', auth_enc: encrypt({}) });
 due(brand, a1); due(b2, a2); setSetting('cap_per_account_per_day', '1');
 try { const o = counting([a1, a2], () => ({ id: 'x' })); await tick(o); await tick(o); assert.equal(o.sends.length, 1); }
 finally { setSetting('cap_per_account_per_day', ''); }
});
test('a 429 rests the whole account, not just the delivery that hit it', async () => {
 const a = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'Busy', external_id: 'busy-1', auth_enc: encrypt({}) });
 due(brand, a); due(brand, a);
 const o = counting([a], () => { throw Object.assign(new Error('Too Many Requests'), { status: 429, retryable: true, retryAfterMs: 3600e3 }); });
 await tick(o); await tick(o); assert.equal(o.sends.length, 1);
});
test('an expired sign-in caught before sending parks the post until the account is reconnected', async () => {
 const a = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'Expired', external_id: 'exp-1', auth_enc: encrypt({}) });
 const p = due(brand, a);
 let expired = true;
 const o = counting([a], () => { if (expired) throw Object.assign(new Error('The sign-in expired. Reconnect the account.'), { needsReconnect: true, definitelyNotSent: true }); return { id: 'ok' }; });
 await tick(o); assert.notEqual(postById(p.id).status, 'failed'); assert.equal(one('SELECT status FROM deliveries WHERE post_id=?', p.id).status, 'retry');
 await tick(o); assert.equal(o.sends.length, 1); // excluded while it needs reconnecting
 expired = false; run('UPDATE accounts SET needs_reconnect=0 WHERE id=?', a); // what oauth.finish does on reconnect
 await tick(o); assert.equal(postById(p.id).status, 'published');
});
test('an action block pauses every row connected to the same remote account', async () => {
 const a = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'Shared A', external_id: 'remote-shared', auth_enc: encrypt({}) });
 const b2 = insert('brands', { slug: 'test2', name: 'Test2', url: 'https://example.org', dir });
 const b = insert('accounts', { brand_id: b2, platform: 'mastodon', label: 'Shared B', external_id: 'remote-shared', auth_enc: encrypt({}) });
 const p = draft(); approvePost(p.id, 1, 'owner'); schedulePost(p.id, 1, [a]);
 run('UPDATE posts SET scheduled_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), p.id); run('UPDATE deliveries SET next_attempt_at = NULL WHERE post_id = ?', p.id);
 await tick({ getProvider: () => ({ publish: async ({ account: x }) => { if (x.id !== a) return { id: 'other' }; throw Object.assign(new Error('blocked'), { actionBlocked: true, definitelyNotSent: true }); } }) });
 assert.equal(one('SELECT paused FROM accounts WHERE id = ?', a).paused, 1);
 assert.equal(one('SELECT paused FROM accounts WHERE id = ?', b).paused, 1);
 assert.equal(one('SELECT paused FROM accounts WHERE id = ?', account).paused, 0); // a different remote account is untouched
});
