// Run Cadence in the background at login: launchd (macOS), systemd --user (Linux), Task Scheduler (Windows).
// File builders are pure so they can be tested; install/uninstall/status shell out with fixed argument lists (no shell, no user text).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LABEL = 'app.cadence.agent';
const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const q = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;

// The service must use the same data folder and port as the CLI that installed it, or `open` signs into a different instance.
const envOf = ({ path, appDir, port }) => ({ PATH: path, CADENCE_DIR: appDir, PORT: String(port) });
export const plist = ({ node, index, logDir, ...c }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${esc(node)}</string><string>--no-warnings</string><string>${esc(index)}</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>${Object.entries(envOf(c)).map(([k, v]) => `<key>${k}</key><string>${esc(v)}</string>`).join('')}</dict>
  <key>StandardOutPath</key><string>${esc(join(logDir, 'cadence.out.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(join(logDir, 'cadence.err.log'))}</string>
</dict></plist>
`;

export const systemdUnit = ({ node, index, ...c }) => `[Unit]
Description=Cadence social media agent
After=network-online.target

[Service]
ExecStart=${q(node)} --no-warnings ${q(index)}
${Object.entries(envOf(c)).map(([k, v]) => `Environment=${q(`${k}=${v}`)}`).join('\n')}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

/** schtasks /TR is capped near 260 characters, so the task runs a small launcher instead of the full command line. */
export const winLauncher = ({ node, index, appDir, port }) => `@echo off\r\nset "CADENCE_DIR=${appDir}"\r\nset "PORT=${port}"\r\n"${node}" --no-warnings "${index}"\r\n`;

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
const ctx = (appDir) => ({ node: process.execPath, index: INDEX, path: process.env.PATH || '', logDir: join(appDir, 'logs'), appDir, port: Number(process.env.PORT || 8796) });

export function installService(appDir, platform = process.platform) {
  const c = ctx(appDir);
  if (platform === 'darwin') {
    const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`), target = `gui/${process.getuid()}`;
    mkdirSync(dirname(file), { recursive: true }); mkdirSync(c.logDir, { recursive: true });
    writeFileSync(file, plist(c));
    try { run('launchctl', ['bootout', `${target}/${LABEL}`]); } catch { /* not loaded yet */ }
    run('launchctl', ['bootstrap', target, file]);
    return `Installed ${file} and started it. Logs: ${c.logDir}`;
  }
  if (platform === 'win32') {
    const launcher = join(appDir, 'cadence-start.cmd');
    writeFileSync(launcher, winLauncher(c));
    try { run('schtasks', ['/Create', '/TN', 'Cadence', '/SC', 'ONLOGON', '/TR', `"${launcher}"`, '/F']); } catch (e) {
      if (/denied/i.test(String(e.stderr))) throw new Error(`Windows needs an Administrator PowerShell to create a logon task. Run it again as Administrator, or put a shortcut to ${launcher} in shell:startup instead.`);
      throw e;
    }
    try { run('schtasks', ['/Run', '/TN', 'Cadence']); } catch { /* starts at next logon */ }
    return 'Created the "Cadence" scheduled task (runs at logon) and started it.';
  }
  const file = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'cadence.service');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, systemdUnit(c));
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', 'cadence.service']);
  return `Installed ${file} and started it. To keep it running after you log out: loginctl enable-linger $USER`;
}

export function uninstallService(appDir, platform = process.platform) {
  if (platform === 'darwin') {
    const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
    try { run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]); } catch { /* not loaded */ }
    rmSync(file, { force: true }); return 'Removed the launchd agent.';
  }
  if (platform === 'win32') {
    try { run('schtasks', ['/Delete', '/TN', 'Cadence', '/F']); } catch { /* absent */ }
    rmSync(join(appDir, 'cadence-start.cmd'), { force: true }); return 'Removed the "Cadence" scheduled task.';
  }
  try { run('systemctl', ['--user', 'disable', '--now', 'cadence.service']); } catch { /* absent */ }
  rmSync(join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'cadence.service'), { force: true });
  try { run('systemctl', ['--user', 'daemon-reload']); } catch { /* no systemd */ }
  return 'Removed the systemd user service.';
}

/** {installed, running, detail} */
export function serviceStatus(appDir, platform = process.platform) {
  try {
    if (platform === 'darwin') {
      const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
      if (!existsSync(file)) return { installed: false, running: false, detail: 'not installed' };
      try { const out = run('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]); return { installed: true, running: /state = running/.test(out), detail: (out.match(/state = (\w+)/) || [])[0] || 'loaded' }; } catch { return { installed: true, running: false, detail: 'installed but not loaded' }; }
    }
    if (platform === 'win32') { const out = run('schtasks', ['/Query', '/TN', 'Cadence', '/FO', 'LIST']); return { installed: true, running: /Status:\s+Running/i.test(out), detail: (out.match(/Status:\s+(.*)/) || [])[1]?.trim() || 'scheduled' }; }
    const state = run('systemctl', ['--user', 'is-active', 'cadence.service']).trim();
    return { installed: true, running: state === 'active', detail: state };
  } catch (e) { return { installed: false, running: false, detail: platform === 'win32' ? 'no "Cadence" scheduled task' : String(e.stderr || 'not installed').trim().split('\n')[0] || 'not installed' }; }
}
