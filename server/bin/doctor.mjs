// `cadence doctor`: one screen of facts, exit code 1 when something blocks Cadence from working.
import { fileURLToPath } from 'node:url';
import { APP_DIR } from '../src/config.js';

export async function doctor(port, isRunning) {
  const { readiness, textCheck } = await import('../src/readiness.js');
  const { PROVIDERS, binPath, agentConfig } = await import('../src/agents.js');
  const { opensslPath, tlsReady } = await import('../src/tls.js');
  let blocked = false;
  const line = (ok, title, msg, blocking = true) => { console.log(`${ok ? 'ok  ' : blocking ? 'FAIL' : 'warn'}  ${title}: ${msg}`); if (!ok && blocking) blocked = true; };
  line(true, 'Node', process.version);
  line(true, 'Data folder', APP_DIR);
  line(await isRunning(), 'Server', `${await isRunning() ? 'running' : 'not running'} on http://127.0.0.1:${port}`, false);
  const text = textCheck();
  line(text.ready, 'Text agent', text.message);
  for (const p of PROVIDERS.filter((x) => x.kind === 'cli')) console.log(`      ${p.name.padEnd(12)} ${binPath(p.id) || 'not found on PATH'}`);
  const cfg = agentConfig(); console.log(`      active: ${cfg.provider}${cfg.model ? ` / ${cfg.model}` : ''}, context ${cfg.context}`);
  line(Boolean(opensslPath()), 'openssl', opensslPath() || 'not found (only needed for Instagram, Facebook, Threads and TikTok sign-in)', false);
  if (opensslPath()) line(tlsReady(), 'https callback certificate', tlsReady() ? 'present' : 'created the first time Cadence starts', false);
  const r = await readiness({ fetchImpl: () => Promise.reject(new Error('skip')) });
  for (const c of r.checks.filter((x) => x.id !== 'text')) line(c.ready, c.title, c.message, false);
  const cli = fileURLToPath(new URL('./cadence.mjs', import.meta.url));
  console.log(`\nAgent integration (MCP, drafts only; add CADENCE_MCP_ROLE=owner to allow approving). Cadence must be running.
      Claude Code  claude mcp add cadence -- node "${cli}" mcp
      Codex CLI    codex mcp add cadence -- node "${cli}" mcp      (or ~/.codex/config.toml: [mcp_servers.cadence] command = "node", args = ["${cli.replace(/\\/g, '\\\\')}", "mcp"])
      Gemini CLI   gemini mcp add cadence node "${cli}" mcp        (or ~/.gemini/settings.json: "mcpServers": {"cadence": {"command": "node", "args": ["${cli.replace(/\\/g, '\\\\')}", "mcp"]}})`);
  console.log(blocked ? '\nSomething above blocks Cadence. Fix the FAIL lines first.' : '\nCadence can run.');
  return blocked ? 1 : 0;
}
