// Compose the final post asset: generated photo + brand tokens + headline, rendered by Playwright.
// Type sizes in the template use vh (viewport = canvas) so layouts scale to any aspect.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR, ASSETS_DIR } from "./config.js";
import { uuid } from "./db.js";

export const CANVAS = { portrait: [1080, 1350], square: [1080, 1080], landscape: [1200, 630] };
export const LAYOUTS = ["editorial", "fullbleed", "split", "type"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function fill(tpl, vars) {
  return tpl
    .replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_, k, inner) => (vars[k] ? inner : ""))
    .replace(/{{(\w+)}}/g, (_, k) => (k === "image" || k === "logo" ? String(vars[k] ?? "") : esc(vars[k])));
}

let browserP;
const browser = () => (browserP ??= chromium.launch());
export async function closeBrowser() { if (browserP) { (await browserP).close(); browserP = undefined; } }

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif" };
// setContent pages have an opaque origin, so local files go in as data URIs.
const dataUrl = (p) => (p && existsSync(p) ? `data:${MIME[p.split(".").pop().toLowerCase()] || "image/png"};base64,${readFileSync(p).toString("base64")}` : "");

/**
 * Render one frame. opts: {aspect, layout, headline, sub, eyebrow, cta, counter, image (path), brand}
 * Returns absolute PNG path.
 */
export async function renderFrame(opts) {
  const { aspect = "portrait", layout = "editorial", brand } = opts;
  const [w, h] = CANVAS[aspect] || CANVAS.portrait;
  const t = brand.tokens || {};
  const tpl = readFileSync(join(TEMPLATES_DIR, "post.html"), "utf8");
  const html = fill(tpl, {
    w, h, lang: brand.voice?.language || "en", layout,
    surface: t.colors?.surface || "#fff", text: t.colors?.text || "#111", accent: t.colors?.accent || "#2563eb", secondary: t.colors?.secondary || "#f2f2f2",
    radius: t.radius || "8px", displayFont: t.fonts?.display || "Inter", bodyFont: t.fonts?.body || "Inter",
    image: dataUrl(opts.image), logo: dataUrl(brand.logo_path),
    headline: opts.headline, sub: opts.sub, eyebrow: opts.eyebrow, cta: opts.cta, counter: opts.counter, bar: layout === "type",
  });
  const page = await (await browser()).newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // shrink headline until it fits its box (max 4 lines)
    await page.evaluate(() => { const h1 = document.querySelector("h1"); let fs = parseFloat(getComputedStyle(h1).fontSize); const box = h1.parentElement; let guard = 40; while (guard-- && (h1.scrollHeight > fs * 4.2 || box.scrollHeight > box.clientHeight + 1) && fs > 24) { fs *= 0.92; h1.style.fontSize = fs + "px"; } });
    const dir = join(ASSETS_DIR, brand.slug || "misc", "renders");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${uuid()}.png`);
    await page.screenshot({ path: out, type: "png" });
    return out;
  } finally { await page.close(); }
}

/** Render a carousel: cover + N slides. Returns array of paths. */
export async function renderCarousel({ brand, slides, image }) {
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    out.push(await renderFrame({ brand, aspect: "square", layout: i === 0 ? "fullbleed" : "slide", image: i === 0 ? image : s.image || image, headline: s.headline, sub: s.sub, eyebrow: s.eyebrow, cta: i === slides.length - 1 ? s.cta : "", counter: `${i + 1}/${slides.length}` }));
  }
  return out;
}
