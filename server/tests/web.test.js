import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
const dir = mkdtempSync(join(tmpdir(), 'cadence-web-')); process.env.CADENCE_DIR = dir;
const { createApiServer, listen } = await import('../src/api.js');
const { ownerToken } = await import('../src/auth.js');
const { db } = await import('../src/db.js');
const server = createApiServer(); const address = await listen(server, 0);
const base = `http://127.0.0.1:${address.port}`;
test.after(async () => { await new Promise((r) => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }); });
// Raw request so Host/paths are sent verbatim (fetch normalises both).
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = httpRequest({ host: '127.0.0.1', port: address.port, path, method, headers: { Host: `127.0.0.1:${address.port}`, ...headers } }, (res) => {
    let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on('error', reject); req.end(body);
});
async function ticket() {
  const r = await raw('/auth/ticket', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(r.status, 200); return JSON.parse(r.body).ticket;
}
async function login() {
  const r = await raw(`/auth/login?c=${await ticket()}`);
  assert.equal(r.status, 302); assert.equal(r.headers.location, '/');
  return r.headers['set-cookie'][0];
}
const jar = (setCookie) => setCookie.split(';')[0];

test('login sets an HttpOnly SameSite=Strict cookie and strips the token from the redirect', async () => {
  const c = await login();
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\//);
  assert.equal((await raw(`/auth/login?t=${ownerToken}`)).status, 401); // the owner token itself is never a login link
  assert.equal((await raw('/auth/login?c=nope')).status, 401);
  assert.equal((await raw('/auth/login')).status, 401);
  assert.equal((await raw('/auth/ticket', { method: 'POST' })).status, 401);
  const t = await ticket();
  assert.equal((await raw(`/auth/login?c=${t}`)).status, 302);
  assert.equal((await raw(`/auth/login?c=${t}`)).status, 401); // single use
});
test('cookie works for GET and for POST only with the CSRF header', async () => {
  const cookie = jar(await login());
  assert.equal((await raw('/api/brands', { headers: { Cookie: cookie } })).status, 200);
  const post = (extra) => raw('/api/brands', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ name: 'T', url: 'https://example.com' }) });
  assert.equal((await post({})).status, 401);
  assert.equal((await post({ 'X-Cadence-CSRF': '1' })).status < 300, true);
  assert.equal((await post({ 'X-Cadence-CSRF': '1', Origin: base })).status < 300, true);
});
test('foreign Origin and bad Host are rejected even with a valid cookie', async () => {
  const cookie = jar(await login());
  assert.equal((await raw('/api/brands', { headers: { Cookie: cookie, Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await raw('/api/brands', { headers: { Cookie: cookie, Origin: 'null' } })).status, 403);
  assert.equal((await raw('/api/brands', { headers: { Cookie: cookie, Host: 'attacker.example' } })).status, 403);
  assert.equal((await raw('/api/brands', { headers: { Cookie: cookie, Host: '127.0.0.1:1' } })).status, 403);
  assert.equal((await raw('/', { headers: { Host: 'evil.test' } })).status, 403);
});
test('logout revokes the session; forged cookies fail', async () => {
  const cookie = jar(await login());
  assert.equal((await raw('/auth/session', { headers: { Cookie: cookie } })).status, 200);
  await raw('/auth/logout', { headers: { Cookie: cookie } }); // GET is not a logout
  assert.equal((await raw('/auth/session', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await raw('/auth/logout', { method: 'POST', headers: { Cookie: cookie, 'X-Cadence-CSRF': '1' } })).status, 204);
  assert.equal((await raw('/api/brands', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await raw('/api/brands', { headers: { Cookie: 'cadence_session=' + 'a'.repeat(64) } })).status, 401);
});
test('a session survives a server restart and the database only holds its hash', async () => {
  const cookie = jar(await login()), id = cookie.split('=')[1];
  const again = createApiServer(); const a2 = await listen(again, 0);
  try {
    const r = await fetch(`http://127.0.0.1:${a2.port}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
  } finally { await new Promise((r) => again.close(r)); }
  const rows = db.prepare('SELECT id FROM sessions').all().map((x) => x.id);
  assert.ok(rows.length > 0 && !rows.includes(id));
});
test('static UI is served with a strict CSP and path traversal is refused', async () => {
  const r = await raw('/');
  assert.equal(r.status, 200); assert.match(r.headers['content-security-policy'], /default-src 'self'/); assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['cache-control'], 'no-store');
  for (const p of ['/../src/config.js', '/%2e%2e/src/config.js', '/..%2fsrc/config.js', '/%2e%2e%2f%2e%2e%2fpackage.json', '/js/..%5c..%5csrc/config.js', '/.hidden', '/fonts/', '/%00', '/js/%00.js'])
    assert.notEqual((await raw(p)).status, 200, p);
  assert.equal((await raw('/', { method: 'POST' })).status, 401);
  const font = await raw('/fonts/hanken-grotesk-latin-wght-normal.woff2', { method: 'HEAD' });
  assert.match(font.headers['cache-control'], /immutable/);
});
test('bearer clients behave as before', async () => {
  const h = { Authorization: `Bearer ${ownerToken}` };
  assert.equal((await raw('/api/brands', { headers: h })).status, 200);
  assert.equal((await raw('/api/brands', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await raw('/api/brands', { headers: { ...h, Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await raw('/api/brands', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B', url: 'https://example.org' }) })).status < 300, true);
});

test('every UI module parses, its relative imports and named imports resolve, and copy has no em-dashes', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, dirname, resolve } = await import('node:path');
  const root = join(import.meta.dirname, '..', 'web', 'js');
  const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []);
  for (const f of files(root)) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /[—–]/, `${f} has an em/en dash`);
    for (const [, names, spec] of src.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)) {
      const target = readFileSync(resolve(dirname(f), spec), 'utf8');
      for (const n of names.split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean))
        assert.match(target, new RegExp(`export (async )?(function|const|class) ${n}\\b|export \\{[^}]*\\b${n}\\b`), `${f} imports missing ${n} from ${spec}`);
    }
  }
});
