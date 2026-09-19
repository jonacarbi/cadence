// Central config: paths, ports, env. Everything is local-first under Application Support.
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
// Evaluate before exporting configuration constants.
loadDotEnv();

const HOME = process.env.HOME;
export const APP_DIR = process.env.CADENCE_DIR || join(HOME, "Library/Application Support/Cadence");
export const DATA_DIR = join(APP_DIR, "data");
export const BRANDS_DIR = join(APP_DIR, "brands");
export const ASSETS_DIR = join(APP_DIR, "assets");
export const LOG_DIR = join(APP_DIR, "logs");
for (const d of [APP_DIR, DATA_DIR, BRANDS_DIR, ASSETS_DIR, LOG_DIR]) mkdirSync(d, { recursive: true, mode: 0o700 });

export const PORT = Number(process.env.PORT || 8796);
export const HOST = "127.0.0.1";
export const BASE_URL = `http://${HOST}:${PORT}`;
export const DB_PATH = join(DATA_DIR, "cadence.sqlite");
export const SKILLS_DIR = join(HOME, ".claude/skills");
export const TEMPLATES_DIR = join(REPO_DIR, "server/templates");

// LLM (Claude Code CLI on the Pro subscription, 9Router as fallback)
export const CLAUDE_BIN = process.env.CADENCE_CLAUDE_BIN || "claude";
export const LLM_MODEL = process.env.CADENCE_MODEL || "opus";
export const NINE_ROUTER_URL = process.env.NINE_ROUTER_URL || "http://localhost:20128/v1";
export const NINE_ROUTER_API_KEY = process.env.NINE_ROUTER_API_KEY || "";
export const NINE_ROUTER_MODEL = process.env.CADENCE_FALLBACK_MODEL || "";

// Images: OpenAI only (user rule). Direct API when a key exists, else the CatGPT gateway (ChatGPT session).
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
export const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
export const CATGPT_URL = process.env.CATGPT_GATEWAY_URL || "http://localhost:8000/v1";
export const CATGPT_TOKEN = process.env.CATGPT_GATEWAY_TOKEN || "";
export const CATGPT_MODEL = process.env.CATGPT_IMAGE_MODEL || "chatgpt";

// Public media hosting (Instagram/Threads/Pinterest need a public URL).
export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
export const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "cadence-media";

// Scheduler
export const TICK_MS = Number(process.env.CADENCE_TICK_MS || 30_000);
export const MAX_ATTEMPTS = 3;
export const BREAKER_THRESHOLD = 3; // consecutive failures → lane paused

// Secret-at-rest key for account tokens (0600 file, generated once).
const KEY_FILE = join(APP_DIR, "secret.key");
export function secretKey() {
  if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
}

// Optional .env files (never committed): repo root for dev, Application Support for the bundled app.
export function loadDotEnv() {
  const home = process.env.HOME;
  const dir = process.env.CADENCE_DIR || join(home, "Library/Application Support/Cadence");
  for (const p of [join(REPO_DIR, ".env"), join(dir, ".env")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
