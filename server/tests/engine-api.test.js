import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(join(tmpdir(), 'cadence-eng-')); process.env.CADENCE_DIR = dir;
process.env.CADENCE_X_CLIENT_ID = '';
const { createApiServer, listen } = await import('../src/api.js');
const { ownerToken, agentToken } = await import('../src/auth.js');
const { db, setSetting, run, one, insert } = await import('../src/db.js');
const { redirectFor } = await import('../src/platforms-setup.js');
const server = createApiServer(); const address = await listen(server, 0); const base = `http://127.0.0.1:${address.port}`;
test.after(async () => { await new Promise((r) => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true }); });
const call = (path, { token = ownerToken, method = 'GET', body } = {}) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('providers list: active, fallback, and five providers; no secret leaks', async () => {
  const j = await (await call('/api/agent/providers')).json();
  assert.equal(j.active.provider, 'claude'); assert.equal(j.fallback, null);
  assert.deepEqual(j.providers.map((p) => p.id), ['claude', 'codex', 'gemini', 'opencode', 'openai']);
  assert.equal(j.active.api_key_set, false);
});

test('PUT provider validates, saves an API key without echoing it', async () => {
  assert.equal((await call('/api/agent/provider', { method: 'PUT', body: { provider: 'nope' } })).status, 400);
  assert.equal((await call('/api/agent/provider', { method: 'PUT', token: agentToken, body: { provider: 'codex' } })).status, 403);
  const r = await call('/api/agent/provider', { method: 'PUT', body: { provider: 'openai', model: 'gpt-5', base_url: 'https://api.example.com/v1', api_key: 'sk-secret-123' } });
  assert.equal(r.status, 200); const text = await r.text();
  assert.ok(!text.includes('sk-secret-123')); assert.equal(JSON.parse(text).active.api_key_set, true);
  const again = await (await call('/api/agent/provider', { method: 'PUT', body: { provider: 'openai', model: 'gpt-5', base_url: 'https://api.example.com/v1', api_key: '' } })).json();
  assert.equal(again.active.api_key_set, true, 'empty key keeps the saved one');
  await call('/api/agent/provider', { method: 'PUT', body: { provider: 'claude', model: 'claude-sonnet-5-5' } });
});

test('platform setup lists 12 rows; saving app credentials flips ready, never echoes the secret', async () => {
  const rows = await (await call('/api/platforms/setup')).json();
  assert.equal(rows.length, 12);
  const x = rows.find((r) => r.id === 'x');
  assert.equal(x.redirect_uri, redirectFor('x')); assert.equal(x.ready, false);
  for (const r of rows) { assert.match(r.create_app_url, /^https:\/\//, r.id); if (r.auth === 'oauth') assert.ok(r.keys_where, r.id); }
  assert.equal(rows.find((r) => r.id === 'instagram').redirect_uri.startsWith('https://localhost:'), true);
  const put = await call('/api/platforms/x/app', { method: 'PUT', body: { client_id: 'abc', client_secret: 'topsecret' } });
  assert.equal(put.status, 200); assert.ok(!(await put.text()).includes('topsecret'));
  assert.equal((await (await call('/api/platforms/setup')).json()).find((r) => r.id === 'x').ready, true);
  assert.equal((await call('/api/platforms/mock/app', { method: 'PUT', body: { client_id: 'a' } })).status >= 400, true);
  assert.ok(readFileSync(join(dir, '.env'), 'utf8').includes('CADENCE_X_CLIENT_ID=abc'));
});

test('safety settings round-trip with validation', async () => {
  const d = await (await call('/api/settings')).json();
  assert.equal(Number(d.min_gap_minutes), 90); assert.equal(Number(d.jitter_minutes), 7); assert.equal(d.warmup, 'on');
  assert.equal((await call('/api/settings', { method: 'PUT', body: { min_gap_minutes: 5000 } })).status, 400);
  assert.equal((await call('/api/settings', { method: 'PUT', body: { warmup: 'maybe' } })).status, 400);
  await call('/api/settings', { method: 'PUT', body: { min_gap_minutes: 30, jitter_minutes: 3, warmup: 'off' } });
  const e = await (await call('/api/settings')).json();
  assert.deepEqual([Number(e.min_gap_minutes), Number(e.jitter_minutes), e.warmup], [30, 3, 'off']);
});

test('accounts expose needs_reconnect', async () => {
  const brand = await (await call('/api/brands', { method: 'POST', body: { name: 'B', url: 'https://example.com' } })).json();
  const id = insert('accounts', { brand_id: brand.id, platform: 'mock', label: 'm', external_id: 'm1', auth_enc: '' });
  run('UPDATE accounts SET needs_reconnect=1 WHERE id=?', id);
  const accts = await (await call('/api/accounts')).json();
  assert.equal(accts.find((a) => a.id === id).needs_reconnect, true);
});

test('webhook secret is write-only; gemini/opencode cannot claim a locked context', async () => {
  await call('/api/settings', { method: 'PUT', body: { webhook_secret: 'whsec-very-private' } });
  const s = await (await call('/api/settings')).text();
  assert.ok(!s.includes('whsec-very-private')); assert.equal(JSON.parse(s).webhook_secret_set, true);
  await call('/api/settings', { method: 'PUT', body: { webhook_secret: '' } }); // clients echo the hidden '' back
  assert.equal(JSON.parse(await (await call('/api/settings')).text()).webhook_secret_set, true);
  for (const provider of ['gemini', 'opencode']) assert.equal((await call('/api/agent/provider', { method: 'PUT', body: { provider, context: 'locked' } })).status, 400);
});

test('brand codification never runs a non-Claude or locked agent with write tools', async () => {
  const { codifyBrand } = await import('../src/brands.js');
  const brand = await (await call('/api/brands', { method: 'POST', body: { name: 'Codify', url: 'https://example.com' } })).json();
  const saved = { ...process.env };
  try {
    for (const env of [{ CADENCE_TEXT_PROVIDER: 'codex' }, { CADENCE_TEXT_PROVIDER: 'claude', CADENCE_AGENT_CONTEXT: 'locked' }]) {
      Object.assign(process.env, env, { CADENCE_CLAUDE_BIN: '/nonexistent/claude', CADENCE_CODEX_BIN: '/nonexistent/codex' });
      await codifyBrand(brand.id); // would throw ENOENT if it tried to spawn
      assert.equal(one('SELECT status FROM brands WHERE id=?', brand.id).status, 'ready-no-skill');
    }
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});

test('locked context beats agentic escalation, is enforced on every run, and agents never see image keys', async () => {
  const { cliSpec, runAgent, agentEnv } = await import('../src/agents.js');
  const args = cliSpec({ provider: 'claude', model: 'm', context: 'locked' }, { agentic: true, args: ['--allowedTools', 'Read'] }).args;
  assert.ok(!args.includes('--allowedTools') && args.includes('--tools'), 'locked drops the per-run tool allowlist');
  for (const provider of ['gemini', 'opencode']) await assert.rejects(runAgent({ provider, model: '', context: 'locked' }, 'hi'), /cannot run locked/);
  const env = agentEnv({ OPENAI_API_KEY: 'k', OPENAI_IMAGE_MODEL: 'm', OPENAI_IMAGE_BASE_URL: 'u', PATH: '/bin', CADENCE_PATH_FIXED: '1' });
  assert.deepEqual(Object.keys(env).sort(), ['CADENCE_PATH_FIXED', 'PATH']);
});

test('agentic Claude runs load no settings and reach only the folders they are given', async () => {
  const { cliSpec, fileScope, rulePath } = await import('../src/agents.js');
  const { SECRET_PATHS } = await import('../src/config.js');
  const args = cliSpec({ provider: 'claude', model: 'm', context: 'full' }, { agentic: true, args: fileScope({ read: ['/b r'], write: ['/s'] }) }).args;
  const at = (f) => args[args.indexOf(f) + 1];
  assert.equal(at('--setting-sources'), '', 'user allow rules would widen the scope');
  assert.equal(at('--permission-mode'), 'dontAsk');
  assert.equal(at('--tools'), 'Read,Write,Edit,Glob,Grep', 'no shell, no web');
  const allowed = args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--disallowedTools'));
  assert.deepEqual(allowed, [`Read(${rulePath('/b r')}/**)`, `Read(${rulePath('/s')}/**)`, `Edit(${rulePath('/s')}/**)`]);
  if (process.platform === 'win32') assert.equal(rulePath('C:\\b r'), '//c/b r');
  else assert.equal(rulePath('/b r'), '//b r');
});

test('no agent may read Cadence secrets, in any mode', async () => {
  const { cliSpec, rulePath } = await import('../src/agents.js');
  const { SECRET_PATHS, APP_DIR } = await import('../src/config.js');
  assert.ok(SECRET_PATHS.includes(join(APP_DIR, 'secret.key')) && SECRET_PATHS.includes(join(APP_DIR, 'owner.token')));
  for (const opts of [{}, { agentic: true, args: [] }]) {
    const args = cliSpec({ provider: 'claude', model: 'm', context: 'full' }, opts).args;
    for (const p of SECRET_PATHS) assert.ok(args.includes(`Read(${rulePath(p)})`) && args.includes(`Read(${rulePath(p)}/**)`), p);
  }
  for (const context of ['full', 'locked']) {
    const args = cliSpec({ provider: 'codex', model: '', context }).args;
    assert.ok(!args.includes('-s'), 'the permission profile replaces the sandbox flag (codex refuses both)');
    const fs = args.find((a) => a.startsWith('permissions.cadence.filesystem='));
    assert.ok(fs.includes("':root'='read'") && !fs.includes('write'));
    for (const p of SECRET_PATHS) assert.ok(fs.includes(`'${p}'='deny'`), p);
    assert.ok(!args.some((a) => a.includes('"')) || SECRET_PATHS.some((p) => p.includes("'")), 'no double quotes for a Windows .cmd shim');
  }
});

test('the design loop is skipped, not half-run, when the agent cannot read images', async () => {
  const { runDesignLoop } = await import('../src/designloop.js');
  const { writeFileSync } = await import('node:fs');
  const brand = await (await call('/api/brands', { method: 'POST', body: { name: 'Loop', url: 'https://loop.example' } })).json();
  writeFileSync(join(one('SELECT dir FROM brands WHERE id=?', brand.id).dir, 'reference.png'), '');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { CADENCE_TEXT_PROVIDER: 'claude', CADENCE_AGENT_CONTEXT: 'locked', CADENCE_CLAUDE_BIN: '/nonexistent/claude' });
    assert.deepEqual(await runDesignLoop(brand.id), { skipped: true });
  } finally { process.env = saved; }
});

test('the webhook secret is sealed at rest, and plain values from older installs get sealed', async () => {
  const { getSetting } = await import('../src/db.js');
  const { SEALED, openEnvValue } = await import('../src/config.js');
  const { sealWebhookSecret } = await import('../src/webhooks.js');
  await call('/api/settings', { method: 'PUT', body: { webhook_secret: 'whsec-at-rest' } });
  const stored = getSetting('webhook_secret', '');
  assert.ok(stored.startsWith(SEALED) && !stored.includes('whsec')); assert.equal(openEnvValue(stored), 'whsec-at-rest');
  setSetting('webhook_secret', 'legacy-plain'); sealWebhookSecret();
  assert.equal(openEnvValue(getSetting('webhook_secret', '')), 'legacy-plain'); assert.ok(getSetting('webhook_secret', '').startsWith(SEALED));
});

test('OAuth sign-in reports its own outcome, so a reconnect is seen without a new row', async () => {
  const { attemptStatus, finish } = await import('../src/oauth.js');
  process.env.CADENCE_X_CLIENT_ID = 'cid';
  const brand = await (await call('/api/brands', { method: 'POST', body: { name: 'OAuthy', url: 'https://oauthy.example' } })).json();
  const { url, state } = await (await call(`/oauth/x/start?brand_id=${brand.id}`)).json();
  assert.ok(url.startsWith('https://') && state);
  assert.equal((await (await call(`/oauth/status?state=${state}`)).json()).status, 'pending');
  assert.equal((await call(`/oauth/status?state=${state}`, { token: agentToken })).status, 403);
  await assert.rejects(finish({ state, error: 'access_denied' }));
  assert.equal(attemptStatus(state).status, 'error');
  process.env.CADENCE_X_CLIENT_ID = '';
});

test('manual identities: Mastodon carries its server, Telegram resolves "@channel" to the numeric chat', async () => {
  const { addManualAccount, migrateMastodonIds } = await import('../src/oauth.js');
  const { encrypt } = await import('../src/db.js');
  const brand = await (await call('/api/brands', { method: 'POST', body: { name: 'Ids', url: 'https://ids.example' } })).json();
  const old = insert('accounts', { brand_id: brand.id, platform: 'mastodon', label: 'm', external_id: '42', auth_enc: encrypt({ instance: 'https://a.social', access_token: 't' }) });
  const typed = insert('accounts', { brand_id: brand.id, platform: 'mastodon', label: 'n', external_id: 'https://b.social/:9', auth_enc: encrypt({ instance: 'https://b.social/', access_token: 't' }) });
  const port = insert('accounts', { brand_id: brand.id, platform: 'mastodon', label: 'p', external_id: '5', auth_enc: encrypt({ instance: 'https://c.social:8443/x', access_token: 't' }) });
  migrateMastodonIds();
  const id = (row) => one('SELECT external_id FROM accounts WHERE id=?', row).external_id;
  assert.equal(id(old), 'https://a.social:42');
  assert.equal(id(typed), 'https://b.social:9', 'an earlier non-canonical migration is repaired');
  assert.equal(id(port), 'https://c.social:8443:5');
  migrateMastodonIds();
  assert.equal(id(port), 'https://c.social:8443:5', 'idempotent');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => ({ json: async () => String(u).includes('/getMe') ? { ok: true, result: { id: 7, username: 'bot' } } : { ok: true, result: { id: -1001, title: 'News' } } });
  try {
    const legacy = insert('accounts', { brand_id: brand.id, platform: 'telegram', label: 't', external_id: '7:@news', auth_enc: encrypt({}) });
    const a = await addManualAccount(brand.id, 'telegram', { bot_token: 'x', chat_id: '@news' });
    assert.equal(a.id, legacy, 'the old "@news" row is updated in place, not duplicated');
    assert.equal(a.external_id, '7:-1001');
    const again = await addManualAccount(brand.id, 'telegram', { bot_token: 'x', chat_id: '-1001' });
    assert.equal(again.id, legacy);
  } finally { globalThis.fetch = realFetch; }
});

test('Retry-After is honoured in full beyond a day, as seconds or a date', async () => {
  const { retryAfterMs } = await import('../src/providers/http.js');
  const res = (v) => new Response(null, { headers: v ? { 'retry-after': v } : {} });
  assert.equal(retryAfterMs(res(String(3 * 86400))), 3 * 86400e3);
  const ms = retryAfterMs(res(new Date(Date.now() + 2 * 86400e3).toUTCString()));
  assert.ok(ms > 47 * 3600e3 && ms <= 48 * 3600e3);
  assert.equal(retryAfterMs(res('1e20')), 365 * 24 * 3600e3, 'garbage stays a valid date');
  assert.equal(retryAfterMs(res('')), 0);
});
