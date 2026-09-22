// Compose the final post asset: generated photo + brand tokens + headline, rendered by Playwright.
// Type sizes in the template use vh (viewport = canvas) so layouts scale to any aspect.
import { launchBrowser } from './browser.js';
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR, ASSETS_DIR } from "./config.js";
import { uuid } from "./db.js";
import { routePublic } from './network.js';

export const CANVAS = { portrait: [1080, 1350], square: [1080, 1080], landscape: [1200, 630] };
export const LAYOUTS = ["editorial", "fullbleed", "split", "type"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function fill(tpl, vars) {
  return tpl
    .replace(/{{#(\w+)}}([\s\S]*?){{\/\1}}/g, (_, k, inner) => (vars[k] ? inner : ""))
    .replace(/{{(\w+)}}/g, (_, k) => (k === "image" || k === "logo" ? String(vars[k] ?? "") : esc(vars[k])));
}

export async function closeBrowser() { /* Each render closes its own browser. */ }

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif" };
// setContent pages have an opaque origin, so local files go in as data URIs.
// The pill label sits on the accent fill, so its ink follows the accent's luminance instead of the surface token,
// which can land at 4:1 on a mid accent.
const ink = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#0b0b0f" : "#ffffff";
};

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
    surface: t.colors?.surface || "#fff", text: t.colors?.text || "#111", accent: t.colors?.accent || "#2563eb", accentInk: ink(t.colors?.accent || "#2563eb"), secondary: t.colors?.secondary || "#f2f2f2",
    radius: t.radius || "8px", displayFont: t.fonts?.display || "Inter", bodyFont: t.fonts?.body || "Inter",
    image: dataUrl(opts.image), logo: dataUrl(brand.logo_path),
    headline: opts.headline, sub: opts.sub, eyebrow: opts.eyebrow, cta: opts.cta, counter: opts.counter, bar: layout === "type",
  });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.context().route('**/*', routePublic);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // shrink headline until it fits its box (max 4 lines)
    await page.evaluate(() => { const h1 = document.querySelector("h1"); let fs = parseFloat(getComputedStyle(h1).fontSize); const box = h1.parentElement; let guard = 40; while (guard-- && (h1.scrollHeight > fs * 3.2 || box.scrollHeight > box.clientHeight + 1) && fs > 24) { fs *= 0.92; h1.style.fontSize = fs + "px"; } });
    // The headline shrinks to fit, so the scale ratio and the gap rhythm are derived from its final size
    // rather than from fixed vh values that drift once it shrinks.
    await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const h1 = q("h1"); if (!h1) return;
      const fs = parseFloat(getComputedStyle(h1).fontSize), lh = fs * 1.06;
      const sub = q("p.sub"), eyebrow = q(".eyebrow"), pill = q(".pill");
      if (sub) sub.style.fontSize = fs / 4 + "px";
      const small = fs / 4 / 1.2 + "px";
      if (eyebrow) eyebrow.style.fontSize = small;
      if (pill) pill.style.fontSize = small;
      if (eyebrow) eyebrow.style.marginBottom = lh * 0.3 + "px";
      h1.style.marginBottom = lh * 0.65 + "px";
      if (sub) sub.style.marginBottom = lh * 1.5 + "px";
    });
    const dir = join(ASSETS_DIR, brand.slug || "misc", "renders");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${uuid()}.jpg`);
    await page.screenshot({ path: out, type: "jpeg", quality: 92 });
    return out;
  } finally { await browser.close(); }
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
