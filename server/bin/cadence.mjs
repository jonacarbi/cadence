#!/usr/bin/env node
// Cadence command line: start | open | doctor | browser | service install|uninstall|status | token
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const WIN = process.platform === 'win32';
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const HELP = `Cadence: your brand, on beat.

  cadence start [--port N]       run the agent in this terminal (web app at http://127.0.0.1:8796)
  cadence open                   open the web app in your browser, already signed in
  cadence doctor                 check Node, the text agent, browser, TLS and connected accounts
  cadence browser                use an installed Chrome/Edge/Chromium, or download Playwright's Chromium
  cadence service install        start Cadence at login (launchd / systemd --user / Task Scheduler)
  cadence service uninstall|status
  cadence mcp                    MCP server over stdio (register it with Claude Code, Codex or Gemini; see doctor)
  cadence token                  print the owner token (secret: it can approve and publish)
`;

const port = () => Number(flag('port') || process.env.PORT || 8796);
if (flag('port')) process.env.PORT = String(port());

async function running() {
  try { return (await fetch(`http://127.0.0.1:${port()}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

function openUrl(url) {
  // Fixed command per OS; the URL is a single argv entry and never goes through a shell (cmd's `start` would mangle the quoted title and split on &).
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]] : WIN ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  const child = spawn(bin, args, { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`Could not open a browser automatically. Open this link yourself:\n${url}`));
  child.unref();
}

if (Number(process.versions.node.split('.')[0]) < 24 && cmd !== 'help') {
  console.error(`Cadence needs Node 24 or newer (this is ${process.version}). Get it from https://nodejs.org`); process.exit(1);
}

if (cmd === 'start') {
  if (!existsSync(new URL('../node_modules/playwright', import.meta.url))) console.warn('Dependencies are not installed. Run: npm install --prefix server');
  await import('../src/index.js');
} else if (cmd === 'open') {
  const { ownerToken } = await import('../src/auth.js');
  if (!(await running())) { console.log(`Cadence is not running on port ${port()}. Start it with "npm start" (or "cadence service install"), then run this again.`); process.exit(1); }
  // Trade the owner token for a single-use, 60-second ticket: only the ticket reaches argv and browser history.
  const r = await fetch(`http://127.0.0.1:${port()}/auth/ticket`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
  if (!r.ok) { console.error(`Sign-in failed (${r.status}). Is this the same data folder the running Cadence uses (CADENCE_DIR)?`); process.exit(1); }
  openUrl(`http://127.0.0.1:${port()}/auth/login?c=${(await r.json()).ticket}`); console.log('Opening Cadence in your browser.');
} else if (cmd === 'mcp') {
  await import('../src/mcp.js'); // stdio JSON-RPC; talks to the running server, so start Cadence first
} else if (cmd === 'token') {
  const { ownerToken } = await import('../src/auth.js');
  console.log(ownerToken);
} else if (cmd === 'doctor') {
  const { doctor } = await import('./doctor.mjs');
  process.exit(await doctor(port(), running));
} else if (cmd === 'browser') {
  // Rendering and website import need a Chromium. Reuse the user's own browser when there is one; otherwise fetch Playwright's.
  const { browserExecutable } = await import('../src/browser.js');
  const found = browserExecutable();
  if (found) { console.log(`Using ${found}`); process.exit(0); }
  console.log('No Chrome, Edge or Chromium found. Downloading Chromium for Playwright (about 150 MB)…');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url)), 'install', 'chromium'], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 1));
} else if (cmd === 'service') {
  const { APP_DIR } = await import('../src/config.js');
  const svc = await import('./service.mjs');
  const action = rest[0];
  try {
    if (action === 'install') console.log(svc.installService(APP_DIR));
    else if (action === 'uninstall') console.log(svc.uninstallService(APP_DIR));
    else if (action === 'status') { const s = svc.serviceStatus(APP_DIR); console.log(`${s.installed ? 'installed' : 'not installed'}${s.installed ? `, ${s.running ? 'running' : 'not running'} (${s.detail})` : ` (${s.detail})`}`); process.exit(s.installed && s.running ? 0 : 1); }
    else { console.log(HELP); process.exit(2); }
  } catch (e) { console.error(`Service ${action} failed: ${String(e.stderr || e.message).trim()}`); process.exit(1); }
} else { console.log(HELP); process.exit(cmd === 'help' || cmd === '--help' || cmd === '-h' ? 0 : 2); }
