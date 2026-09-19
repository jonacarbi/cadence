// Image generation — OpenAI models only. Direct API (gpt-image-1, quality high) when OPENAI_API_KEY is set,
// otherwise the CatGPT gateway (ChatGPT Plus session, same image model, at localhost:8000).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR, OPENAI_API_KEY, OPENAI_IMAGE_MODEL, CATGPT_URL, CATGPT_TOKEN, CATGPT_MODEL } from "./config.js";
import { uuid } from "./db.js";

export const SIZES = { portrait: "1024x1536", square: "1024x1024", landscape: "1536x1024" };

async function viaOpenAI(prompt, size) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
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
    throw new Error(`CATGPT_DOWN: gateway unreachable (${e.message}). Run \`catgpt\` in a terminal.`);
  }
  if (!res.ok) throw new Error(`catgpt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64 || b64.length < 100) throw new Error("catgpt returned empty image");
  return b64;
}

/** Generate one image, save to ASSETS_DIR/<brandSlug>/, return absolute path. */
export async function generateImage(prompt, { aspect = "portrait", brandSlug = "misc" } = {}) {
  const size = SIZES[aspect] || SIZES.portrait;
  const b64 = OPENAI_API_KEY ? await viaOpenAI(prompt, size) : await viaCatGPT(prompt, size);
  const dir = join(ASSETS_DIR, brandSlug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${uuid()}.png`);
  writeFileSync(path, Buffer.from(b64, "base64"));
  return path;
}

export const imageProvider = () => (OPENAI_API_KEY ? `openai:${OPENAI_IMAGE_MODEL}` : `catgpt:${CATGPT_MODEL}`);
