// Central config: paths, ports, env. Everything is local-first under Application Support.
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
// Evaluate before exporting configuration constants.
loadDotEnv();

const HOME = homedir();
const WIN = process.platform === "win32";

/** Per-user data directory. macOS keeps the historical Application Support path so existing installs carry on. */
export function resolveAppDir(env = process.env, platform = process.platform, home = homedir()) {
  if (env.CADENCE_DIR) return env.CADENCE_DIR;
  if (platform === "darwin") return join(home, "Library", "Application Support", "Cadence");
  if (platform === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Cadence");
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "cadence");
}

// A GUI/service-launched app inherits a minimal PATH, so CLI tools the user installed (claude, python3, browsers)
// are invisible or resolve to a different install than their shell uses. Adopt the login shell's PATH once (POSIX only).
if (!process.env.CADENCE_PATH_FIXED) {
  if (!WIN) try {
    const shellPath = execFileSync(process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"), ["-lic", "printf '\\n__CADENCE_PATH__%s' \"$PATH\""], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"], cwd: HOME, detached: true }); // detached: an interactive zsh otherwise steals the parent terminal (claude gets SIGTTIN)
    // The marker keeps rc-file banners out of PATH.
    const [, found] = shellPath.split("__CADENCE_PATH__");
    if (found?.trim().includes("/")) process.env.PATH = found.trim();
  } catch { /* keep the inherited PATH */ }
  process.env.CADENCE_PATH_FIXED = "1";
}
/** Find an executable on PATH. On Windows only PATHEXT names (.cmd shims from npm, .exe, .bat). */
export function findBin(bin, env = process.env, win = WIN) {
  const exts = win ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").toLowerCase().split(";").filter(Boolean) : [""]; // never the extensionless sh shim npm also installs
  const dirs = (env.PATH || env.Path || "").split(delimiter).filter(Boolean);
  for (const d of dirs) for (const e of exts) { const p = join(d, bin + e); try { if (existsSync(p) && statSync(p).isFile()) return p; } catch { /* unreadable dir */ } }
  return undefined;
}
export const APP_DIR = resolveAppDir();
export const DATA_DIR = join(APP_DIR, "data");
export const BRANDS_DIR = join(APP_DIR, "brands");
export const ASSETS_DIR = join(APP_DIR, "assets");
export const LOG_DIR = join(APP_DIR, "logs");
// Empty working dir for text agents: prompts carry untrusted website text, and a read-only agent started in APP_DIR
// could be talked into reading .env or the tokens next to it. Agents may only read inside their cwd without a prompt.
export const AGENT_DIR = join(APP_DIR, "agent-work");
for (const d of [APP_DIR, DATA_DIR, BRANDS_DIR, ASSETS_DIR, LOG_DIR, AGENT_DIR]) mkdirSync(d, { recursive: true, mode: 0o700 });

export const PORT = Number(process.env.PORT || 8796);
export const HOST = "127.0.0.1";
export const BASE_URL = `http://${HOST}:${PORT}`;
// Meta requires an https OAuth redirect, so the callback also gets a TLS listener when a cert exists.
export const TLS_DIR = join(APP_DIR, "tls");
export const HTTPS_PORT = PORT + 1;
export const DB_PATH = join(DATA_DIR, "cadence.sqlite");
// What no agent may read, whatever it is talked into: keys, tokens, sealed .env, the database and its backups, TLS key.
export const SECRET_PATHS = [...["secret.key", "owner.token", "agent.token", ".env", "data", "backups", "tls"].map((f) => join(APP_DIR, f)), join(REPO_DIR, ".env")];
export const SKILLS_DIR = join(HOME, ".claude", "skills");
export const TEMPLATES_DIR = join(REPO_DIR, "server/templates");

// LLM: see agents.js
// Agent provider settings are read from process.env at call time (see agents.js) so the app can change them without a restart.
// Only the legacy constants other modules still import are kept here.
export const CLAUDE_BIN = process.env.CADENCE_CLAUDE_BIN || findBin("claude") || [join(HOME, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"].find(existsSync) || "claude";

// Images: openai (API key; any OpenAI-compatible /images/generations via OPENAI_IMAGE_BASE_URL) or none (branded layout, no AI photo).
// Opt-in presets for a local ChatGPT-session gateway: catgpt, oga-mcp (Open Generative AI MCP, needs CADENCE_OGA_MCP_ENTRY).
// `let` exports are live bindings: reloadEnvSettings() after a Settings save updates every importer, no restart needed.
export let OPENAI_API_KEY, OPENAI_IMAGE_BASE_URL, OPENAI_IMAGE_MODEL, CATGPT_URL, CATGPT_TOKEN, CATGPT_MODEL, IMAGE_PROVIDER, OGA_MCP_ENTRY;
// Public media hosting (Instagram/Threads/Pinterest need a public URL).
export let SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET;
export function reloadEnvSettings(env = process.env) {
  OPENAI_API_KEY = env.OPENAI_API_KEY || "";
  OPENAI_IMAGE_BASE_URL = (env.OPENAI_IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  OPENAI_IMAGE_MODEL = env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  CATGPT_URL = env.CATGPT_GATEWAY_URL || "http://localhost:8000/v1";
  CATGPT_TOKEN = env.CATGPT_GATEWAY_TOKEN || "";
  CATGPT_MODEL = env.CATGPT_IMAGE_MODEL || "chatgpt";
  IMAGE_PROVIDER = env.CADENCE_IMAGE_PROVIDER || (OPENAI_API_KEY ? "openai" : "none");
  OGA_MCP_ENTRY = env.CADENCE_OGA_MCP_ENTRY || "";
  SUPABASE_URL = env.SUPABASE_URL || "";
  SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY || "";
  SUPABASE_BUCKET = env.SUPABASE_BUCKET || "cadence-media";
}
reloadEnvSettings();

// Scheduler
export const TICK_MS = Number(process.env.CADENCE_TICK_MS || 30_000);
export const MAX_ATTEMPTS = 3;
export const BREAKER_THRESHOLD = 3; // consecutive failures → lane paused

// Secret-at-rest key for account tokens (0600 file, generated once).
// A function, not a const: loadDotEnv() runs at the top of this module, before any const below exists.
export function secretKey(dir = resolveAppDir()) {
  const file = join(dir, "secret.key");
  if (!existsSync(file)) { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 }); }
  return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
}

// Secret .env values are AES-256-GCM sealed with the same key as account tokens, so a copied, synced or pasted
// .env carries no usable credential. Plain values (hand-edited, repo .env) still load and get sealed on next start.
export const SEALED = "enc:v1:";
export function sealEnvValue(v) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([c.update(v, "utf8"), c.final()]);
  return SEALED + Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
/** `dir`: open a value from another data folder's .env with that folder's key (the smoke test's isolated run). */
export function openEnvValue(v, dir) {
  if (!v.startsWith("enc:v1:")) return v; // literal, not SEALED: this runs during loadDotEnv(), before that const exists
  try {
    const buf = Buffer.from(v.slice(7), "base64"), d = createDecipheriv("aes-256-gcm", secretKey(dir), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch { console.error("[config] a sealed .env value no longer matches secret.key; re-enter it in Settings"); return ""; }
}

// Optional .env files (never committed). First definition wins, so the data-folder .env (what the app writes) beats a
// repo-root .env left over from development; otherwise a saved setting would silently revert on restart.
/** dotenv rules: a quoted value is taken literally; in an unquoted one, " #" starts a comment. */
export function parseEnvValue(raw) { const q = raw.match(/^(["'])(.*)\1$/); return q ? q[2] : raw.replace(/\s+#.*$/, ""); }

export function loadDotEnv() {
  for (const p of [join(resolveAppDir(), ".env"), join(REPO_DIR, ".env")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = openEnvValue(parseEnvValue(m[2]));
    }
  }
}
