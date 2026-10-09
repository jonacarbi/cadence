import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveAppDir } from '../src/config.js';
import { DEFAULT_CAPS, dailyCap, jitterMs, backoffMs, duplicateTextWarnings, WARMUP_DAYS } from '../src/safety.js';
import { agentConfig, cliSpec, claudeArgs } from '../src/agents.js';
import { browserCandidates } from '../src/browser.js';
import { trustHint } from '../src/tls.js';
import { plist, systemdUnit, winLauncher } from '../bin/service.mjs';

const CFG = { cap: 0, gap: 90, jitter: 7, warmup: true };
const old = { platform: 'x', created_at: '2020-01-01 00:00:00' };

test('data folder per OS, CADENCE_DIR wins', () => {
  assert.equal(resolveAppDir({}, 'darwin', '/h'), join('/h', 'Library', 'Application Support', 'Cadence'));
  assert.equal(resolveAppDir({ APPDATA: '/a' }, 'win32', '/h'), join('/a', 'Cadence'));
  assert.equal(resolveAppDir({ XDG_DATA_HOME: '/x' }, 'linux', '/h'), join('/x', 'cadence'));
  assert.equal(resolveAppDir({}, 'linux', '/h'), join('/h', '.local', 'share', 'cadence'));
  assert.equal(resolveAppDir({ CADENCE_DIR: '/c' }, 'darwin', '/h'), '/c');
});

test('daily caps: platform default, owner override, warm-up halves, mock exempt', () => {
  assert.equal(dailyCap(old, CFG), DEFAULT_CAPS.x);
  assert.equal(dailyCap(old, { ...CFG, cap: 3 }), 3);
  const fresh = { platform: 'reddit', created_at: new Date(Date.now() - 86400e3).toISOString() };
  assert.equal(dailyCap(fresh, CFG), 1);
  assert.equal(dailyCap({ platform: 'x', created_at: new Date().toISOString() }, CFG), DEFAULT_CAPS.x / 2);
  assert.equal(dailyCap({ platform: 'x', created_at: new Date().toISOString() }, { ...CFG, warmup: false }), DEFAULT_CAPS.x);
  assert.equal(dailyCap({ platform: 'x', created_at: new Date(Date.now() - (WARMUP_DAYS + 1) * 86400e3).toISOString() }, CFG), DEFAULT_CAPS.x);
  assert.equal(dailyCap({ platform: 'mock', created_at: '2020-01-01' }, CFG), Infinity);
});

test('jitter stays within [0, minutes] and is never negative', () => {
  assert.equal(jitterMs(7, () => 0), 0);
  assert.ok(jitterMs(7, () => 0.999999) <= 7 * 60_000);
  assert.equal(jitterMs(0, () => 0.9), 0);
  assert.equal(jitterMs(-5, () => 0.9), 0);
});

test('backoff honours Retry-After and grows exponentially', () => {
  assert.equal(backoffMs(0), 60_000);
  assert.equal(backoffMs(2), 240_000);
  assert.equal(backoffMs(0, 600_000), 600_000);
  assert.ok(backoffMs(99) <= 60_000 * 1024);
});

test('duplicate text across accounts of one platform warns, single accounts do not', () => {
  const post = { copy: { x: 'hi' } };
  assert.equal(duplicateTextWarnings(post, [{ platform: 'x' }]).length, 0);
  assert.equal(duplicateTextWarnings(post, [{ platform: 'x' }, { platform: 'x' }]).length, 1);
});

test('agentConfig: defaults, legacy 9router env, unknown provider', () => {
  assert.deepEqual(agentConfig('primary', {}), { provider: 'claude', model: 'claude-sonnet-5-5', context: 'full', base_url: '', api_key: '' });
  assert.equal(agentConfig('fallback', {}), null);
  const legacy = agentConfig('primary', { CADENCE_TEXT_PROVIDER: '9router', CADENCE_FALLBACK_MODEL: 'm1', NINE_ROUTER_URL: 'http://r/v1/' });
  assert.equal(legacy.provider, 'openai'); assert.equal(legacy.model, 'm1'); assert.equal(legacy.base_url, 'http://r/v1');
  assert.throws(() => agentConfig('primary', { CADENCE_TEXT_PROVIDER: 'nope' }), /Unknown agent provider/);
  assert.equal(agentConfig('primary', { CADENCE_AGENT_CONTEXT: 'locked' }).context, 'locked');
});

test('CLI specs never put the prompt in argv and keep tools read-only', () => {
  const c = cliSpec({ provider: 'claude', model: 'm', context: 'full' });
  assert.ok(c.args.includes('Read,Grep,Glob,Skill') && !c.args.some((a) => /Bash|Write|Edit/.test(a)));
  assert.ok(claudeArgs({ model: 'm', context: 'locked' }).includes('--disable-slash-commands'));
  assert.ok(cliSpec({ provider: 'codex', model: 'g', context: 'full' }).args.some((a) => a.startsWith('permissions.cadence.filesystem={\x27:root\x27=\x27read\x27')));
  assert.ok(JSON.parse(cliSpec({ provider: 'opencode', model: '', context: 'full' }).env.OPENCODE_PERMISSION).bash === 'deny');
});

test('browser candidates cover every OS', () => {
  assert.ok(browserCandidates('darwin').some((p) => /Google Chrome/.test(p)));
  process.env.ProgramFiles = 'C:\\Program Files';
  assert.ok(browserCandidates('win32').some((p) => /chrome\.exe|msedge\.exe/i.test(p)));
  assert.ok(browserCandidates('linux').length > 0);
});

test('trust hints and service files', () => {
  assert.match(trustHint('darwin'), /security add-trusted-cert/);
  assert.match(trustHint('win32'), /Import-Certificate/);
  assert.match(trustHint('linux'), /chrome:\/\/settings\/certificates/);
  assert.match(plist({ node: '/n', index: '/i&.js', logDir: '/l', path: '/p', appDir: '/d', port: 9000 }), /app\.cadence\.agent[\s\S]*\/i&amp;\.js[\s\S]*<key>CADENCE_DIR<\/key><string>\/d<\/string><key>PORT<\/key><string>9000/);
  const unit = systemdUnit({ node: '/n', index: '/i', path: '/p', appDir: '/d', port: 9000 });
  assert.match(unit, /ExecStart="\/n" --no-warnings "\/i"/); assert.match(unit, /Environment="CADENCE_DIR=\/d"/); assert.match(unit, /Environment="PORT=9000"/);
  assert.match(winLauncher({ node: 'C:\\n.exe', index: 'C:\\i.js', appDir: 'C:\\d', port: 9000 }), /^@echo off\r\nset "CADENCE_DIR=C:\\d"\r\nset "PORT=9000"\r\n"C:\\n\.exe"/);
});

test('images: default is none without a key, and readiness never mentions CatGPT then', async () => {
  const dir = (await import('node:fs')).mkdtempSync(join((await import('node:os')).tmpdir(), 'cadence-img-'));
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `
    const { generateImage, imageProvider } = await import('./src/images.js');
    const { readiness } = await import('./src/readiness.js');
    const img = (await readiness()).checks.find((c) => c.id === 'images');
    console.log(JSON.stringify({ p: imageProvider(), g: await generateImage('x'), img }));`],
  { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', env: { ...process.env, CADENCE_DIR: dir, CADENCE_IMAGE_PROVIDER: '', OPENAI_API_KEY: '', CADENCE_OGA_MCP_ENTRY: '' } });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r.p, 'none'); assert.equal(r.g, null); assert.equal(r.img.ready, true);
  assert.doesNotMatch(r.img.message, /CatGPT/i);
});

test('agent children never inherit Cadence secrets; Windows never resolves the extensionless npm shim', async () => {
  const { agentEnv } = await import('../src/agents.js');
  const { findBin } = await import('../src/config.js');
  const env = agentEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', CADENCE_X_CLIENT_SECRET: 's', CADENCE_OPENAI_API_KEY: 'k', SUPABASE_SERVICE_KEY: 'k', CATGPT_GATEWAY_TOKEN: 't', CADENCE_PATH_FIXED: '1' });
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'CADENCE_PATH_FIXED', 'HOME', 'PATH']);
  const d = mkdtempSync(join(tmpdir(), 'cadence-bin-'));
  writeFileSync(join(d, 'claude'), '#!/bin/sh'); writeFileSync(join(d, 'claude.cmd'), '@echo off');
  assert.equal(findBin('claude', { PATH: d, PATHEXT: '.EXE;.CMD' }, true), join(d, 'claude.cmd'));
  rmSync(d, { recursive: true, force: true });
});
