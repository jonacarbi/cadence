// Owner-supplied credentials. Everything Cadence talks to needs a key of some kind, and until now the
// only way to supply one was to hand-edit the .env file. This writes that same file from the app.
// Values go in one place — <Application Support>/Cadence/.env, mode 0600 — and are never read back out
// over the API: a credential surface that can show its own secrets is a credential surface that leaks.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR } from './config.js';
import { WorkflowError } from './workflow.js';
import { logEvent, one } from './db.js';

const ENV_PATH = join(APP_DIR, '.env');

/** The only keys the app may write. An allowlist, so a typo cannot inject an unrelated variable. */
export const FIELDS = [
  { key: 'OPENAI_API_KEY', title: 'OpenAI API key', group: 'Images', hint: 'Generates every post image. Without it Cadence falls back to a local ChatGPT gateway.' },
  { key: 'CATGPT_GATEWAY_TOKEN', title: 'CatGPT gateway token', group: 'Images', hint: 'Token for a local ChatGPT-session gateway, used when there is no OpenAI key.' },
  { key: 'SUPABASE_URL', title: 'Supabase project URL', group: 'Media hosting', hint: 'Instagram, Threads and TikTok can only publish an image that is already on a public URL.', secret: false },
  { key: 'SUPABASE_SERVICE_KEY', title: 'Supabase service key', group: 'Media hosting', hint: 'Write access to the media bucket.' },
  ...['instagram', 'facebook', 'linkedin', 'x', 'threads', 'pinterest', 'tiktok', 'reddit'].flatMap((p) => [
    { key: `${p.toUpperCase()}_CLIENT_ID`, title: `${p} client ID`, group: 'Social sign-in', hint: `From the ${p} developer portal. Needed before “Sign in” works for ${p}.`, secret: false },
    { key: `${p.toUpperCase()}_CLIENT_SECRET`, title: `${p} client secret`, group: 'Social sign-in', hint: `Paired with the ${p} client ID.` },
  ]),
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

/** What is configured — never what it is set to. */
export const listCredentials = () => FIELDS.map((f) => ({ ...f, secret: f.secret !== false, set: Boolean(process.env[f.key]) }));

/** Write one credential, or clear it with an empty value. Returns the same shape as listCredentials. */
export function setCredential(key, value) {
  const field = BY_KEY.get(key);
  if (!field) throw new WorkflowError('That is not a credential Cadence uses');
  if (typeof value !== 'string') throw new WorkflowError('A credential must be text');
  const clean = value.trim();
  // A newline would let one value forge a second variable in the file.
  if (/[\n\r]/.test(clean)) throw new WorkflowError('A credential cannot contain a line break');
  if (clean.length > 4000) throw new WorkflowError('That credential is too long');
  const lines = (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split('\n') : []).filter((l) => !l.match(new RegExp(`^\\s*${key}\\s*=`)));
  if (clean) lines.push(`${key}=${clean}`);
  writeFileSync(ENV_PATH, `${lines.filter((l, i) => l.trim() || i < lines.length - 1).join('\n').trimEnd()}\n`, { mode: 0o600 });
  chmodSync(ENV_PATH, 0o600); // An .env that predates this code may be world-readable.
  if (clean) process.env[key] = clean; else delete process.env[key];
  logEvent('info', 'credential.set', `${field.title} ${clean ? 'saved' : 'cleared'}`, { key }); // The name, never the value.
  // Config constants are read once at import, so the running process keeps the old value until it restarts.
  return { credentials: listCredentials(), restart_required: true };
}

/** Apply saved credentials by restarting the agent. launchd (KeepAlive) brings it straight back up.
 *  A restart marks running work interrupted, so it waits for the queue to be idle rather than deciding
 *  for the owner that a half-finished month is expendable. */
export function requestRestart({ exit = () => process.exit(0) } = {}) {
  const running = one("SELECT type FROM jobs WHERE status = 'running' LIMIT 1");
  if (running) throw new WorkflowError(`“${running.type}” is still running. Wait for it to finish, then restart.`, 409);
  logEvent('warn', 'agent.restart', 'Restarting the background agent to apply new credentials', {});
  setTimeout(exit, 250).unref?.(); // Let the response flush first.
  return { ok: true, message: 'Restarting. The agent is back in a few seconds.' };
}
