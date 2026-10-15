// Image generation: openai (default when OPENAI_API_KEY is set), codex (Codex CLI on the user's ChatGPT sign-in), none (no AI photo), or the opt-in catgpt / oga-mcp presets.
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { runAgent } from "./agents.js";
import { ASSETS_DIR, OPENAI_API_KEY, OPENAI_IMAGE_BASE_URL, OPENAI_IMAGE_MODEL, CATGPT_URL, CATGPT_TOKEN, CATGPT_MODEL, IMAGE_PROVIDER } from "./config.js";
import { uuid } from "./db.js";
import { generateWithOGA } from './oga-images.js';

export const SIZES = { portrait: "1024x1536", square: "1024x1024", landscape: "1536x1024" };

async function viaOpenAI(prompt, size) {
  const res = await fetch(`${OPENAI_IMAGE_BASE_URL}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, n: 1, size, quality: "high", output_format: "png" }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) throw new Error(`openai images ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data[0].b64_json;
}

async function viaCatGPT(prompt, size) {
  let res;
  try {
    res = await fetch(`${CATGPT_URL}/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${CATGPT_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ model: CATGPT_MODEL, prompt, n: 1, size, response_format: "b64_json" }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (e) {
    // A timeout is not an unreachable gateway: the gateway answers, but the browser session behind the
    // account stopped responding (logged out, or the container was OOM-killed). Different fix, so say so.
    if (e.name === 'TimeoutError') throw new Error('CATGPT_STUCK: the ChatGPT session behind the gateway stopped responding. Open its noVNC window and sign in again, or set an OpenAI API key in Settings.');
    throw new Error(`CATGPT_DOWN: gateway unreachable (${e.message}). Run \`catgpt\` in a terminal.`);
  }
  if (!res.ok) throw new Error(`catgpt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64 || b64.length < 100) throw new Error("catgpt returned empty image");
  return b64;
}

// Codex saves its image under CODEX_HOME/generated_images and reports the path; only a fresh PNG/JPEG from there is accepted.
async function viaCodex(prompt, aspect, dir) {
  const started = Date.now(), cwd = mkdtempSync(join(dir, ".codex-"));
  try {
    const out = await runAgent({ provider: "codex", model: "", context: "full" }, `Use your image generation tool exactly once to create this image (${aspect} aspect ratio). Do not run any shell commands. Prompt, verbatim:\n\n${prompt}\n\nWhen done, reply with exactly one line: IMAGE: <absolute path of the generated image file>`, { cwd, timeout: 480_000 });
    const path = out.match(/^IMAGE: (.+)$/m)?.[1]?.trim();
    if (!path) throw new Error(`Codex made no image: ${out.slice(-300)}`);
    const real = realpathSync(path), rel = relative(realpathSync(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "generated_images")), real);
    if (rel.startsWith("..") || isAbsolute(rel) || statSync(real).mtimeMs < started - 5000) throw new Error("Codex reported an image it did not just generate");
    const bytes = readFileSync(real);
    if (!((bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0xff && bytes[1] === 0xd8))) throw new Error("Codex did not return a PNG or JPEG image");
    return bytes.toString("base64");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

/** Generate one image, save to ASSETS_DIR/<brandSlug>/, return absolute path (null for provider "none"). */
export async function generateImage(prompt, { aspect = "portrait", brandSlug = "misc" } = {}) {
  if(IMAGE_PROVIDER==='none')return null;
  if(IMAGE_PROVIDER==='oga-mcp')return generateWithOGA(prompt,{aspect,brandSlug});
  if(!['openai','catgpt','codex'].includes(IMAGE_PROVIDER))throw new Error('Unknown image provider: use openai, codex, none, catgpt or oga-mcp');
  const size = SIZES[aspect] || SIZES.portrait;
  if(IMAGE_PROVIDER==='openai'&&!OPENAI_API_KEY)throw new Error('OpenAI image API key is not configured');
  const dir = join(ASSETS_DIR, brandSlug);
  mkdirSync(dir, { recursive: true });
  const b64 = IMAGE_PROVIDER==='codex' ? await viaCodex(prompt, aspect, dir) : IMAGE_PROVIDER==='openai' ? await viaOpenAI(prompt, size) : await viaCatGPT(prompt, size);
  const path = join(dir, `${uuid()}.png`);
  writeFileSync(path, Buffer.from(b64, "base64"));
  return path;
}

export const imageProvider = () => IMAGE_PROVIDER==='none'?'none':IMAGE_PROVIDER==='oga-mcp'?`oga-mcp:catgpt:${CATGPT_MODEL}`:IMAGE_PROVIDER==='codex'?'codex':IMAGE_PROVIDER==='openai'?`openai:${OPENAI_IMAGE_MODEL}`:`catgpt:${CATGPT_MODEL}`;
