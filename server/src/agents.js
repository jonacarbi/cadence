// Pluggable text agents. CLI agents (Claude Code, Codex, Gemini, opencode) run non-interactively with the prompt on STDIN
// (Windows' 32K argv limit, and .cmd shims must never see prompt text). `openai` is any OpenAI-compatible /chat/completions.
// All settings are read from process.env at CALL time so PUT /api/agent/provider applies without a restart.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { findBin, AGENT_DIR, CLAUDE_BIN, SECRET_PATHS } from "./config.js";

export const DEFAULT_PROVIDER = "claude";
export const DEFAULT_MODEL = "claude-sonnet-5-5";
const WIN = process.platform === "win32";
const OPENAI_FIELDS = [
  { key: "base_url", title: "Base URL", secret: false, placeholder: "https://api.openai.com/v1" },
  { key: "api_key", title: "API key", secret: true, placeholder: "sk-…" },
];
const cli = (id, name, docs_url, models, extra = {}) => ({ id, name, kind: "cli", docs_url, models, fields: [], ...extra });
export const PROVIDERS = [
  cli("claude", "Claude Code", "https://docs.claude.com/en/docs/claude-code", ["claude-sonnet-5-5", "claude-opus-4-5", "claude-haiku-4-5"]),
  cli("codex", "Codex CLI", "https://github.com/openai/codex", ["gpt-5-codex", "gpt-5"]),
  cli("gemini", "Gemini CLI", "https://github.com/google-gemini/gemini-cli", ["gemini-2.5-pro", "gemini-2.5-flash"]),
  cli("opencode", "opencode", "https://opencode.ai/docs", ["anthropic/claude-sonnet-4-5", "openai/gpt-5"]),
  { id: "openai", name: "OpenAI-compatible API", kind: "http", docs_url: "https://platform.openai.com/docs/api-reference/chat", models: ["gpt-5", "gpt-4.1-mini"], fields: OPENAI_FIELDS },
];
export const providerInfo = (id) => PROVIDERS.find((p) => p.id === id);
const BIN_ENV = { claude: "CADENCE_CLAUDE_BIN", codex: "CADENCE_CODEX_BIN", gemini: "CADENCE_GEMINI_BIN", opencode: "CADENCE_OPENCODE_BIN" };
export const binPath = (id) => (id === "claude" ? process.env.CADENCE_CLAUDE_BIN || findBin("claude") || (CLAUDE_BIN !== "claude" ? CLAUDE_BIN : undefined) : process.env[BIN_ENV[id]] || findBin(id));

/** Resolve the active (or fallback) provider config from env. `9router` is the legacy spelling of an `openai` preset. */
export function agentConfig(which = "primary", env = process.env) {
  const fb = which === "fallback";
  let provider = (fb ? env.CADENCE_FALLBACK_PROVIDER : env.CADENCE_TEXT_PROVIDER) || (fb && env.CADENCE_FALLBACK_MODEL ? "9router" : fb ? "" : DEFAULT_PROVIDER);
  if (!provider) return null;
  let model = (fb ? env.CADENCE_FALLBACK_MODEL : env.CADENCE_MODEL) || "";
  let base_url = env.CADENCE_OPENAI_BASE_URL || "", api_key = env.CADENCE_OPENAI_API_KEY || "";
  if (provider === "9router") { // existing installs: NINE_ROUTER_* + CADENCE_FALLBACK_MODEL
    provider = "openai"; base_url = env.NINE_ROUTER_URL || "http://localhost:20128/v1"; api_key = env.NINE_ROUTER_API_KEY || "";
    if (!fb) model = env.CADENCE_FALLBACK_MODEL || model;
  }
  if (!providerInfo(provider)) throw new Error(`Unknown agent provider "${provider}". Use one of: ${PROVIDERS.map((p) => p.id).join(", ")}.`);
  if (!model && !fb) model = provider === "claude" ? DEFAULT_MODEL : "";
  const context = env.CADENCE_AGENT_CONTEXT === "locked" ? "locked" : "full";
  return { provider, model, context, base_url: base_url.replace(/\/$/, ""), api_key };
}

// Claude. 'full' = the user's own memory (CLAUDE.md), settings and skills, but only read-only built-in tools, no MCP:
// prompts embed untrusted website text, so write/exec/network tools stay off. 'locked' = nothing loaded at all.
// Agentic runs (design-dna, critics) load no settings at all: a user's allow rules would widen any scope we pass, and a
// project file in a folder the agent can write would widen the next run. dontAsk then refuses every path not in `args`.
export function claudeArgs({ model, context, agentic, args }) {
  const mode = agentic ? ["--setting-sources", "", "--permission-mode", "dontAsk", "--tools", "Read,Write,Edit,Glob,Grep"]
    : context === "locked" ? ["--tools", "", "--setting-sources", "", "--disable-slash-commands"]
    : ["--setting-sources", "user,project", "--tools", "Read,Grep,Glob,Skill"];
  // Deny rules beat every allow rule, the user's own included, so Cadence's secrets stay out of reach in every mode.
  const deny = ["--disallowedTools", ...SECRET_PATHS.map((p) => `Read(${rulePath(p)})`), ...SECRET_PATHS.map((p) => `Read(${rulePath(p)}/**)`)];
  return ["-p", "--model", model, "--output-format", "text", ...(agentic ? args : []), ...deny, ...mode, "--strict-mcp-config", "--no-session-persistence"];
}
// Codex: a read-only permission profile (no writes, no network) that still cannot read Cadence's secrets.
// TOML literal strings ('…'): no double quotes, which a Windows .cmd shim refuses (see spawnPlan).
const tomlStr = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);
export const codexProfile = () => ["-c", "default_permissions='cadence'", "-c",
  `permissions.cadence.filesystem={${[[":root", "read"], ...SECRET_PATHS.map((p) => [p, "deny"])].map(([k, v]) => `${tomlStr(k)}=${tomlStr(v)}`).join(",")}}`];
/** Claude Code permission path for an absolute folder: `//abs/path`, with Windows `C:\\x` written as `//c/x`. */
export const rulePath = (p) => "/" + resolve(p).replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => "/" + d.toLowerCase());
/** Allow rules for an agentic run: read `read` + `write`, edit `write`. Nothing else is reachable (see claudeArgs). */
export const fileScope = ({ read = [], write = [] }) => ["--allowedTools",
  ...[...read, ...write].map((d) => `Read(${rulePath(d)}/**)`), ...write.map((d) => `Edit(${rulePath(d)}/**)`)];
export function cliSpec(cfg, { agentic = false, args = [], cwd = AGENT_DIR } = {}) {
  const { provider: p, model, context } = cfg, locked = context === "locked";
  agentic = agentic && p === "claude" && !locked; // only Claude Code takes a per-run tool allowlist, and locked always wins
  if (p === "claude") return { args: claudeArgs({ model, context, agentic, args }), env: { CLAUDECODE: "" } };
  if (p === "codex") return { args: ["exec", "--ephemeral", "--skip-git-repo-check", ...codexProfile(), "-C", cwd, ...(locked ? ["--ignore-user-config", "--ignore-rules"] : []), ...(model ? ["-m", model] : []), "-"], env: {} };
  if (p === "gemini") return { args: [...(model ? ["-m", model] : []), "-p", "Follow the instructions provided on stdin."], env: {}, inlineSystem: true };
  // opencode: deny edit/bash/web via its documented permission env var.
  return { args: ["run", ...(model ? ["-m", model] : [])], env: { OPENCODE_PERMISSION: JSON.stringify({ edit: "deny", bash: "deny", webfetch: "deny" }) }, inlineSystem: true, clean: true };
}

const BAD_SHELL = /["&|<>^%\r\n`]/;
/** Build the spawn call. Windows .cmd/.bat shims need cmd.exe; args are validated so no text can break out. */
export function spawnPlan(bin, args) {
  if (!(WIN && /\.(cmd|bat)$/i.test(bin))) return { file: bin, args, opts: {} };
  for (const a of args) if (BAD_SHELL.test(a)) throw new Error(`Refusing to pass "${a.slice(0, 20)}…" through a Windows shell`);
  const q = (a) => (a === "" || /[\s,;=()]/.test(a) ? `"${a}"` : a);
  return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[`"${bin}"`, ...args.map(q)].join(" ")}"`], opts: { windowsVerbatimArguments: true } };
}

// Cadence's own secrets (platform client secrets, provider keys, Supabase) never reach a third-party CLI.
const PRIVATE_ENV = /^(CADENCE_(?!PATH_FIXED$)|SUPABASE_|NINE_ROUTER_|CATGPT_|OPENAI_API_KEY$|OPENAI_IMAGE_)/;
export const agentEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !PRIVATE_ENV.test(k)));

export function runCli(cfg, prompt, { system = "", cwd = AGENT_DIR, timeout = 600_000, agentic = false, args = [] } = {}) {
  const bin = binPath(cfg.provider);
  if (!bin) return Promise.reject(Object.assign(new Error(`${providerInfo(cfg.provider).name} is not installed (looked for "${cfg.provider}" on PATH).`), { code: "ENOENT" }));
  const spec = cliSpec(cfg, { agentic, args, cwd });
  const argv = [...spec.args];
  let input = prompt;
  if (system) { if (spec.inlineSystem || cfg.provider === "codex" || WIN) input = `${system}\n\n---\n\n${prompt}`; else argv.push("--system-prompt", system); }
  const plan = spawnPlan(bin, argv);
  return new Promise((resolve, reject) => {
    const child = spawn(plan.file, plan.args, { cwd, env: { ...agentEnv(), ...spec.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, ...plan.opts });
    let out = "", err = "", done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill(); finish(reject, Object.assign(new Error("timed out"), { stdout: out, stderr: err })); }, timeout);
    child.stdout.on("data", (d) => { out += d; if (out.length > 64e6) child.kill(); });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    child.on("error", (e) => finish(reject, Object.assign(e, { stdout: out, stderr: err })));
    child.stdin.on("error", () => {}); // CLI exited before reading stdin
    child.on("close", (code) => code === 0 ? finish(resolve, spec.clean ? out.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\s*> .*\n/gm, "") : out) : finish(reject, Object.assign(new Error(`exit ${code}`), { code, stdout: out, stderr: err })));
    child.stdin.end(input);
  });
}

export async function runHttp(cfg, prompt, { system = "" } = {}) {
  if (!cfg.base_url) throw new Error("Set a base URL for the OpenAI-compatible provider.");
  if (!cfg.model) throw new Error("Set a model for the OpenAI-compatible provider.");
  const res = await fetch(`${cfg.base_url}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", ...(cfg.api_key && { authorization: `Bearer ${cfg.api_key}` }) },
    body: JSON.stringify({ model: cfg.model, stream: false, messages: [system && { role: "system", content: system }, { role: "user", content: prompt }].filter(Boolean) }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`${new URL(cfg.base_url).host} answered ${res.status}${res.status === 401 ? " (check the API key)" : ""}`);
  const content = (await res.json()).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("The model returned no content");
  return content;
}

export const LOCK_UNSUPPORTED = new Set(["gemini", "opencode"]); // no flag to skip their user config
/** Run one prompt on one provider config. */
export async function runAgent(cfg, prompt, opts = {}) {
  // Every path (primary, fallback, env-configured) lands here, so the support check lives here too.
  if (cfg.context === "locked" && LOCK_UNSUPPORTED.has(cfg.provider)) throw new Error(`${providerInfo(cfg.provider).name} cannot run locked; set the agent context to 'full' or pick another provider.`);
  if (cfg.provider === "openai") return (await runHttp(cfg, prompt, opts)).trim();
  try { return (await runCli(cfg, prompt, opts)).trim(); } catch (error) {
    const name = providerInfo(cfg.provider).name;
    // stderr, or a short stdout (Claude prints its limit notice there): a long stdout is generated copy that may say "limit".
    const said = `${error.stderr || ""}${(error.stdout || "").length < 500 ? error.stdout || "" : ""}`;
    if (/usage limit|rate limit|quota/i.test(said)) throw Object.assign(new Error(`${name} usage limit reached. Configure a fallback provider (CADENCE_FALLBACK_PROVIDER / CADENCE_FALLBACK_MODEL) or wait for your quota to reset.`), { quota: true });
    if (error.code === "ENOENT") throw error;
    const detail = (error.stderr || "").trim().slice(-300).replace(/(sk-|Bearer\s+|key[=:]\s*)[\w.-]{8,}/gi, "$1[redacted]");
    throw new Error(`${name} generation failed (${error.code || "timeout"})${detail ? `: ${detail}` : `. Check that ${name} is signed in.`}`);
  }
}
