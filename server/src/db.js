// SQLite via node:sqlite. One file, WAL, small helper layer. Secrets encrypted with AES-256-GCM.
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { DB_PATH, secretKey } from "./config.js";

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
  tokens_json TEXT NOT NULL DEFAULT '{}', design_system_md TEXT NOT NULL DEFAULT '',
  voice_json TEXT NOT NULL DEFAULT '{}', skill_slug TEXT, logo_path TEXT, dir TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE, platform TEXT NOT NULL,
  label TEXT NOT NULL, external_id TEXT, auth_enc TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
  trusted INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE, month TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '', plan_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'planning',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', pillar TEXT, topic TEXT, hook TEXT,
  format TEXT NOT NULL DEFAULT 'single', platforms_json TEXT NOT NULL DEFAULT '[]', copy_json TEXT NOT NULL DEFAULT '{}',
  image_prompt TEXT, alt_text TEXT, image_path TEXT, assets_json TEXT NOT NULL DEFAULT '{}',
  lint_json TEXT NOT NULL DEFAULT '[]', published_json TEXT NOT NULL DEFAULT '{}', error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, tags TEXT NOT NULL DEFAULT '',
  approved_by TEXT, drafted_by TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS posts_due ON posts(status, scheduled_at);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, ref_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', log TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL DEFAULT (datetime('now')), level TEXT NOT NULL,
  kind TEXT NOT NULL, message TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS analytics (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, platform TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')), metrics_json TEXT NOT NULL, PRIMARY KEY (post_id, platform));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY, brand_id TEXT REFERENCES brands(id), campaign_id TEXT REFERENCES campaigns(id),
  input_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id), version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', remote_id TEXT, remote_url TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, error TEXT,
  started_at TEXT, finished_at TEXT,
  UNIQUE(post_id, account_id, version));
CREATE TABLE IF NOT EXISTS design_systems (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL, source_kind TEXT NOT NULL, source_path TEXT NOT NULL,
  source_project_url TEXT, content_hash TEXT NOT NULL, snapshot_dir TEXT NOT NULL,
  manifest_json TEXT NOT NULL, summary_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(brand_id, content_hash));
CREATE UNIQUE INDEX IF NOT EXISTS design_system_active ON design_systems(brand_id) WHERE active = 1;
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  url TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', paused INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(brand_id, url));
CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  guid TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '', post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  drafted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, guid));
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  path TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

// Additive migrations preserve existing local installations.
for (const table of ['campaigns', 'posts']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'design_system_id')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN design_system_id TEXT REFERENCES design_systems(id)`);
  }
}

if (!db.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'needs_reconnect')) {
  db.exec('ALTER TABLE accounts ADD COLUMN needs_reconnect INTEGER NOT NULL DEFAULT 0');
}

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();

export function one(sql, ...params) { return db.prepare(sql).get(...params) ?? null; }
export function all(sql, ...params) { return db.prepare(sql).all(...params); }
export function run(sql, ...params) { return db.prepare(sql).run(...params); }

/** Insert a row from a plain object. Returns the id. */
export function insert(table, obj) {
  const row = { id: uuid(), ...obj };
  const keys = Object.keys(row);
  run(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]));
  return row.id;
}
/** Update columns on one row by id. Returns a fresh copy. */
export function update(table, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return one(`SELECT * FROM ${table} WHERE id = ?`, id);
  const hasUpdated = table === "posts" || table === "jobs";
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(",")}${hasUpdated ? ", updated_at = datetime('now')" : ""} WHERE id = ?`,
    ...keys.map((k) => patch[k]), id);
  return one(`SELECT * FROM ${table} WHERE id = ?`, id);
}

export function getSetting(key, fallback = null) {
  const r = one("SELECT value FROM settings WHERE key = ?", key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(key, value) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
}

export function logEvent(level, kind, message, data = {}) {
  run("INSERT INTO events (level, kind, message, data_json) VALUES (?, ?, ?, ?)", level, kind, message, JSON.stringify(data));
  const line = `${now()} [${level}] ${kind}: ${message}`;
  (level === "error" ? console.error : console.log)(line);
}

// --- secrets at rest ---
export function encrypt(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}
export function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const d = createDecipheriv("aes-256-gcm", secretKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
}

/** Parse JSON columns of a post/brand row into a plain object safe for the API. */
export function hydrate(row) {
  if (!row) return row;
  const out = { ...row };
  for (const k of Object.keys(out)) {
    if (k.endsWith("_json")) { try { out[k.slice(0, -5)] = JSON.parse(out[k]); } catch { out[k.slice(0, -5)] = null; } delete out[k]; }
    if (k === "auth_enc") delete out[k];
    if (k === "needs_reconnect") out[k] = Boolean(out[k]);
  }
  return out;
}
