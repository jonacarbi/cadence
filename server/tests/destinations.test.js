import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cadence-dest-'));
process.env.CADENCE_DIR = dir;
const { db, insert, encrypt, decrypt, one } = await import('../src/db.js');
const { listDestinations, setDestination } = await import('../src/oauth.js');
test.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const brand = insert('brands', { slug: 'd', name: 'D', url: 'https://example.com', dir });
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('a Facebook account switches to another Page from the same sign-in without exposing tokens', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ data: [{ id: 'p1', name: 'First', access_token: 'tok1' }, { id: 'p2', name: 'Second', access_token: 'tok2' }] }));
  const id = insert('accounts', { brand_id: brand, platform: 'facebook', label: 'First', external_id: 'p1', auth_enc: encrypt({ access_token: 'user', page_token: 'tok1' }) });
  const list = await listDestinations(id);
  assert.deepEqual(list, [{ key: 'p1', label: 'First', current: true }, { key: 'p2', label: 'Second', current: false }]);
  assert.ok(!JSON.stringify(list).includes('tok'));
  await setDestination(id, 'p2');
  const row = one('SELECT * FROM accounts WHERE id = ?', id);
  assert.equal(row.external_id, 'p2'); assert.equal(row.label, 'Second');
  assert.equal(decrypt(row.auth_enc).page_token, 'tok2');
  await assert.rejects(setDestination(id, 'nope'), /not available/);
  insert('accounts', { brand_id: brand, platform: 'facebook', label: 'First', external_id: 'p1', auth_enc: encrypt({}) });
  await assert.rejects(setDestination(id, 'p1'), (e) => e.status === 409);
});

test('a Pinterest account switches boards and keeps the same user id', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => json(String(url).includes('/boards') ? { items: [{ id: 'b1', name: 'Ideas' }, { id: 'b2', name: 'Shop' }] } : { username: 'me' }));
  const id = insert('accounts', { brand_id: brand, platform: 'pinterest', label: 'me', external_id: 'me', auth_enc: encrypt({ access_token: 'x', board_id: 'b1', expires_at: Date.now() + 3_600_000 }) });
  assert.deepEqual((await listDestinations(id)).map((d) => [d.key, d.current]), [['b1', true], ['b2', false]]);
  await setDestination(id, 'b2');
  const row = one('SELECT * FROM accounts WHERE id = ?', id);
  assert.equal(row.external_id, 'me'); assert.equal(decrypt(row.auth_enc).board_id, 'b2');
});

test('platforms with one destination per sign-in refuse the picker', async () => {
  const id = insert('accounts', { brand_id: brand, platform: 'mastodon', label: 'M', auth_enc: encrypt({}) });
  await assert.rejects(listDestinations(id), /single destination/);
});
