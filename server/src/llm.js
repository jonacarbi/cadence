// LLM access through the configured agent provider (agents.js), with an optional fallback provider.
import { agentConfig, runAgent } from "./agents.js";
import { AGENT_DIR } from "./config.js";

/** Run a prompt on the active provider. Extra args are Claude-only (agentic jobs: design-dna, critics enable tools/skills).
 *  cwd defaults to AGENT_DIR (empty, inside the data folder, never next to .env): an app update replaces the bundle the server was launched from, and `claude`
 *  refuses to run ("current working directory was deleted") when it inherits that stale inode. */
export async function claude(prompt, { model, cwd = AGENT_DIR, ...opts } = {}) {
  const cfg = agentConfig();
  return runAgent(model && cfg.provider === "claude" ? { ...cfg, model } : cfg, prompt, { cwd, ...opts });
}

/** Plain-text completion; falls back to CADENCE_FALLBACK_PROVIDER/MODEL (or the legacy 9Router model) on failure. */
export async function complete(prompt, opts = {}) {
  const { model, args, agentic, ...rest } = opts; // agentic options never apply to a plain completion
  try { return await claude(prompt, { ...opts }); } catch (e) {
    const fb = agentConfig("fallback");
    if (!fb) throw e;
    try { return await runAgent(fb, prompt, rest); } catch (e2) { throw e.quota ? e : e2; }
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
