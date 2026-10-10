// Owner-supplied credentials. Everything Cadence talks to needs a key of some kind, and until now the
// only way to supply one was to hand-edit the .env file. This writes that same file from the app.
// Values go in one place — <Application Support>/Cadence/.env, mode 0600, secrets AES-GCM sealed — and are never read back out
// over the API: a credential surface that can show its own secrets is a credential surface that leaks.
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR, REPO_DIR, reloadEnvSettings, sealEnvValue, parseEnvValue, SEALED } from './config.js';
import { WorkflowError } from './workflow.js';
import { logEvent, one } from './db.js';

const ENV_PATH = join(APP_DIR, '.env');

/** The only keys the app may write. An allowlist, so a typo cannot inject an unrelated variable. */
export const FIELDS = [
  { key: 'OPENAI_API_KEY', title: 'OpenAI API key', group: 'Images', hint: 'Generates every post image. Without it posts use the branded layout only (no AI photo). Works with any OpenAI-compatible images endpoint via OPENAI_IMAGE_BASE_URL.' },
  { key: 'CATGPT_GATEWAY_TOKEN', title: 'CatGPT gateway token', group: 'Images', hint: 'Token for a local ChatGPT-session gateway, used when there is no OpenAI key.' },
  { key: 'SUPABASE_URL', title: 'Supabase project URL', group: 'Media hosting', hint: 'Instagram, Threads and TikTok can only publish an image that is already on a public URL.', secret: false },
  { key: 'SUPABASE_SERVICE_KEY', title: 'Supabase service key', group: 'Media hosting', hint: 'Write access to the media bucket.' },
  ...['instagram', 'facebook', 'linkedin', 'x', 'threads', 'pinterest', 'tiktok', 'reddit'].flatMap((p) => [
    { key: `CADENCE_${p.toUpperCase()}_CLIENT_ID`, title: `${p[0].toUpperCase() + p.slice(1)} client ID`, group: 'Social sign-in', hint: `From the ${p} developer portal. Needed before “Sign in” works for ${p}.`, secret: false },
    { key: `CADENCE_${p.toUpperCase()}_CLIENT_SECRET`, title: `${p[0].toUpperCase() + p.slice(1)} client secret`, group: 'Social sign-in', hint: `Paired with the ${p} client ID.` },
  ]),
];
// Agent settings are written by PUT /api/agent/provider, not listed in the credentials screen.
export const AGENT_FIELDS = [
  { key: 'CADENCE_TEXT_PROVIDER', title: 'Agent provider', secret: false }, { key: 'CADENCE_MODEL', title: 'Agent model', secret: false },
  { key: 'CADENCE_AGENT_CONTEXT', title: 'Agent context', secret: false }, { key: 'CADENCE_OPENAI_BASE_URL', title: 'OpenAI-compatible base URL', secret: false },
  { key: 'CADENCE_OPENAI_API_KEY', title: 'OpenAI-compatible API key' },
  { key: 'CADENCE_FALLBACK_PROVIDER', title: 'Fallback provider', secret: false }, { key: 'CADENCE_FALLBACK_MODEL', title: 'Fallback model', secret: false },
  { key: 'NINE_ROUTER_API_KEY', title: '9Router API key (legacy)' }, // never written by the UI; listed so it gets sealed
];
const BY_KEY = new Map([...FIELDS, ...AGENT_FIELDS].map((f) => [f.key, f]));

/** What is configured — never what it is set to. */
export const listCredentials = () => FIELDS.map((f) => ({ ...f, secret: f.secret !== false, set: Boolean(process.env[f.key]) }));

/** Write one credential, or clear it with an empty value. Returns the same shape as listCredentials. */
export function setCredential(key, value) {
  writeEnvValue(key, value);
  return { credentials: listCredentials(), restart_required: false };
}

/** Persist one allowlisted key to .env and apply it to the running process. */
export function writeEnvValue(key, value) {
  const field = BY_KEY.get(key);
  if (!field) throw new WorkflowError('That is not a credential Cadence uses');
  if (typeof value !== 'string') throw new WorkflowError('A credential must be text');
  const clean = value.trim();
  // A newline would let one value forge a second variable in the file.
  if (/[\n\r]/.test(clean)) throw new WorkflowError('A credential cannot contain a line break');
  if (clean.length > 4000) throw new WorkflowError('That credential is too long');
  const lines = (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : []).filter((l) => !l.match(new RegExp(`^\\s*${key}\\s*=`)));
  // Quote anything the reader would otherwise trim as a comment or unwrap as quotes.
  const needsQuote = /\s#|^["']/.test(clean), q = clean.includes("'") ? '"' : "'";
  if (field.secret === false && needsQuote && clean.includes(q)) throw new WorkflowError('That credential mixes quotes and " #" in a way the settings file cannot store');
  // A cleared key stays as `KEY=`: the first definition wins, so this keeps an older repo-root .env value from returning on restart.
  lines.push(`${key}=${!clean ? '' : field.secret === false ? (needsQuote ? q + clean + q : clean) : sealEnvValue(clean)}`);
  // Temp file + rename: a crash mid-write must not truncate every saved credential. The new file is 0600 from birth.
  const tmp = `${ENV_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, `${lines.filter((l, i) => l.trim() || i < lines.length - 1).join('\n').trimEnd()}\n`, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* Windows: ACLs, not modes */ }
  renameSync(tmp, ENV_PATH);
  if (clean) process.env[key] = clean; else delete process.env[key];
  reloadEnvSettings();
  logEvent('info', 'credential.set', `${field.title} ${clean ? 'saved' : 'cleared'}`, { key }); // The name, never the value.
}

/** Seal any secret still stored as plain text (older installs, hand edits) in both .env files the server reads. Runs once
 *  per start and rewrites only the file: an environment override keeps winning in memory, but its file copy is sealed too. */
export function sealPlainSecrets(paths = [ENV_PATH, join(REPO_DIR, '.env')]) {
  for (const p of paths) {
    if (!existsSync(p)) continue;
    let changed = false;
    const lines = readFileSync(p, 'utf8').split(/\r?\n/).map((line) => {
      const m = line.match(/^(\s*([A-Z0-9_]+)\s*=\s*)(.*?)\s*$/), field = m && BY_KEY.get(m[2]);
      const raw = m && parseEnvValue(m[3]);
      if (!field || field.secret === false || !raw || raw.startsWith(SEALED)) return line;
      changed = true;
      return `${m[2]}=${sealEnvValue(raw)}`;
    });
    if (!changed) continue;
    try {
      const tmp = `${p}.${process.pid}.tmp`;
      writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
      try { chmodSync(tmp, 0o600); } catch { /* Windows: ACLs, not modes */ }
      renameSync(tmp, p);
      logEvent('info', 'credential.seal', `sealed plain-text secrets in ${p}`);
    } catch (e) { logEvent('warn', 'credential.seal', `could not seal ${p}: ${e.message}`); } // e.g. a read-only app bundle
  }
}
