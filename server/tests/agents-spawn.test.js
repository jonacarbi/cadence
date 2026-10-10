// Spawns a stand-in agent CLI the way real ones are installed: a plain executable on macOS/Linux and an
// npm-style .cmd shim on Windows. Every flag Cadence passes must arrive byte for byte, and the prompt (stdin) untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cadence spawn '));
process.env.CADENCE_DIR = join(dir, 'data');
const { runCli, cliSpec, fileScope } = await import('../src/agents.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

const script = join(dir, 'fake-agent.mjs');
writeFileSync(script, `#!${process.execPath}\nlet s='';process.stdin.on('data',(d)=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({argv:process.argv.slice(2),stdin:s})));\n`);
let bin = script;
if (process.platform === 'win32') { bin = join(dir, 'fake-agent.cmd'); writeFileSync(bin, `@"${process.execPath}" "%~dp0\\fake-agent.mjs" %*\r\n`); }
else chmodSync(script, 0o755);

const PROMPT = 'Write a caption: "50% off" & <free> shipping | today ^ only `now`\nline two, café ☕';
for (const [provider, opts] of [['claude', {}], ['claude', { agentic: true, args: fileScope({ read: [dir], write: [join(dir, 'out dir')] }) }], ['codex', {}]]) {
  for (const context of ['full', 'locked']) {
    test(`${provider}${opts.agentic ? ' agentic' : ''} (${context}) receives exact flags and prompt`, async () => {
      process.env[`CADENCE_${provider.toUpperCase()}_BIN`] = bin;
      const cfg = { provider, model: provider === 'claude' ? 'claude-sonnet-5-5' : 'gpt-5', context };
      const got = JSON.parse(await runCli(cfg, PROMPT, { ...opts, cwd: dir, timeout: 30_000 }));
      assert.deepEqual(got.argv, cliSpec(cfg, { ...opts, cwd: dir }).args);
      assert.equal(got.stdin, PROMPT);
    });
  }
}
