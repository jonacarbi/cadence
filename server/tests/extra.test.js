import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
});
