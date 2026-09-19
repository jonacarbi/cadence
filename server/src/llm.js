// LLM access: Claude Code CLI (`claude -p`, Pro subscription) first, 9Router chat completions as fallback.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLAUDE_BIN, LLM_MODEL, NINE_ROUTER_URL, NINE_ROUTER_API_KEY, NINE_ROUTER_MODEL } from "./config.js";

const exec = promisify(execFile);

/** Run a prompt through `claude -p`. Extra args let callers enable tools/skills for agentic jobs. */
export async function claude(prompt, { system = "", model = LLM_MODEL, args = [], cwd, timeout = 600_000, agentic = false } = {}) {
  // Plain completions run locked down (no tools, no skills). Agentic jobs (design-dna, critics) keep user skills + the tools they pass.
  const lockdown = agentic ? ["--setting-sources", "user"] : ["--tools", "", "--setting-sources", "", "--disable-slash-commands"];
  const argv = ["-p", prompt, "--model", model, "--output-format", "text", ...args, ...lockdown, "--strict-mcp-config", "--no-session-persistence"];
  if (system) argv.push("--system-prompt", system);
  const { stdout } = await exec(CLAUDE_BIN, argv, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CLAUDECODE: "" } });
  return stdout.trim();
}

async function nineRouter(prompt, system) {
  if (!NINE_ROUTER_MODEL) throw new Error("no fallback model configured (CADENCE_FALLBACK_MODEL)");
  const res = await fetch(`${NINE_ROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${NINE_ROUTER_API_KEY}` },
    body: JSON.stringify({ model: NINE_ROUTER_MODEL, messages: [system && { role: "system", content: system }, { role: "user", content: prompt }].filter(Boolean) }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`9router ${res.status}`);
  return (await res.json()).choices[0].message.content;
}

/** Plain-text completion with fallback. */
export async function complete(prompt, opts = {}) {
  try { return await claude(prompt, opts); } catch (e) {
    if (!NINE_ROUTER_MODEL) throw e;
    return nineRouter(prompt, opts.system);
  }
}

/** Extract the first JSON value from model output, tolerating code fences and prose. */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = Math.min(...["{", "["].map((ch) => { const i = c.indexOf(ch); return i < 0 ? Infinity : i; }));
    if (!Number.isFinite(start)) continue;
    const s = c.slice(start);
    for (let end = s.length; end > 0; end--) {
      const ch = s[end - 1];
      if (ch !== "}" && ch !== "]") continue;
      try { return JSON.parse(s.slice(0, end)); } catch { /* keep trimming */ }
    }
  }
  throw new Error("model returned no JSON");
}

/** JSON completion: asks for strict JSON, parses, retries once on failure. */
export async function completeJson(prompt, opts = {}) {
  const system = `${opts.system || ""}\nRespond with a single JSON value only. No prose, no markdown fences.`.trim();
  try { return parseJson(await complete(prompt, { ...opts, system })); } catch {
    return parseJson(await complete(`${prompt}\n\nREMINDER: output valid JSON only.`, { ...opts, system }));
  }
}
