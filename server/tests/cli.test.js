// End-to-end smoke on the real CLI: `cadence start` boots, `cadence token` reads the same data folder,
// and the browser sign-in works. CI runs this on Linux, macOS and Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/cadence.mjs', import.meta.url));
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('cadence start serves the UI and a CLI-issued ticket signs the browser in', { timeout: 60_000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-cli-')), port = await freePort();
  const env = { ...process.env, CADENCE_DIR: dir, PORT: String(port) };
  const server = spawn(process.execPath, ['--no-warnings', CLI, 'start'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; server.stderr.on('data', (d) => { stderr += d; });
  t.after(() => { server.kill(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 200)); }
  assert.ok((await fetch(`${base}/health`).catch(() => ({ ok: false }))).ok, `server did not start: ${stderr}`);
  assert.match(await (await fetch(base)).text(), /<html/i);

  const token = execFileSync(process.execPath, ['--no-warnings', CLI, 'token'], { env, encoding: 'utf8' }).trim();
  const { ticket } = await (await fetch(`${base}/auth/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json();
  const login = await fetch(`${base}/auth/login?c=${ticket}`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/brands`, { headers: { Cookie: cookie } })).status, 200);
});
