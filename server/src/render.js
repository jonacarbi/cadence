// Compose the final post asset: generated photo + brand tokens + headline, rendered by Playwright.
// Type sizes in the template use vh (viewport = canvas) so layouts scale to any aspect.
import { launchBrowser } from './browser.js';
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR, ASSETS_DIR } from "./config.js";
import { uuid } from "./db.js";
import { routePublic } from './network.js';
import { resolveFonts } from './fonts.js';

export const CANVAS = { portrait: [1080, 1350], square: [1080, 1080], landscape: [1200, 630] };
export const LAYOUTS = ["editorial", "fullbleed", "split", "type"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SECTION = /{{#(\w+)}}([\s\S]*?){{\/\1}}/g;
const RAW = ["image", "logo", "lockup", "fontCss"];
function fill(tpl, vars) {
  // One pass only emits a section's body, it does not re-scan it, so a section nested inside another
  // survives verbatim into the markup. Keep passing until nothing matches.
  let out = tpl, prev;
  do { prev = out; out = out.replace(SECTION, (_, k, inner) => (vars[k] ? inner : "")); } while (out !== prev);
  return out.replace(/{{(\w+)}}/g, (_, k) => (RAW.includes(k) ? String(vars[k] ?? "") : esc(vars[k])));
}

export async function closeBrowser() { /* Each render closes its own browser. */ }

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif" };
// setContent pages have an opaque origin, so local files go in as data URIs.
// The pill label sits on the accent fill, so it takes whichever of black or white measures further
// from that fill rather than the surface token's ink.
const ink = (hex) => (ratio("#ffffff", hex) >= ratio("#0b0b0f", hex) ? "#ffffff" : "#0b0b0f");

// WCAG floor for the accent against the surface: the loop's colour critic fails below 4.5:1,
// and a mid accent on a dark surface lands around 4.2:1. Lift the accent until it clears.
const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return x === null || y === null ? 21 : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const contrastFix = (accent, surface) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(accent || ""));
  if (!m || ratio(accent, surface) >= 4.5) return accent;
  const up = lum(surface) < 0.2;
  let rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  for (let i = 0; i < 24; i++) {
    rgb = rgb.map((v) => Math.round(up ? v + (255 - v) * 0.06 : v * 0.94));
    const hex = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
    if (ratio(hex, surface) >= 4.5) return hex;
  }
  return up ? "#ffffff" : "#000000";
};

const dataUrl = (p) => (p && existsSync(p) ? `data:${MIME[p.split(".").pop().toLowerCase()] || "image/png"};base64,${readFileSync(p).toString("base64")}` : "");
// An <img> gives an SVG its own document, where currentColor resolves to black — a brand mark drawn in
// currentColor then disappears on a dark surface. Paint it in the text token before encoding.
const logoUrl = (p, color) => {
  if (!p || !existsSync(p)) return "";
  if (!/\.svg$/i.test(p)) return dataUrl(p);
  // An extracted mark often lacks xmlns, which is legal inline but makes the file unparseable as an
  // image document, so the <img> silently renders nothing.
  let svg = readFileSync(p, "utf8").replaceAll("currentColor", color);
  if (!/xmlns=/.test(svg)) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
};

/**
 * Render one frame. opts: {aspect, layout, headline, sub, eyebrow, cta, counter, image (path), brand}
 * Returns absolute PNG path.
 */
export async function renderFrame(opts) {
  const { aspect = "portrait", layout = "editorial", brand } = opts;
  const [w, h] = CANVAS[aspect] || CANVAS.portrait;
  const t = brand.tokens || {};
  const surface = t.colors?.surface || "#fff";
  const accent = contrastFix(t.colors?.accent || "#2563eb", surface);
  const fonts = await resolveFonts(t);
  const mark = logoUrl(brand.logo_path, t.colors?.text || "#111");
  const lockup = layout === "type" ? mark : "";
  // A mid accent is too close to both black and white for a label to clear 7:1 on it. Lifting the fill
  // would break the accent's own 4.5:1 floor against the surface, so the pill loses its fill instead and
  // the label measures against the surface, where the text token already clears by a wide margin.
  const accentInk = ink(accent);
  const outline = layout === "type" || ratio(accentInk, accent) < 7;
  const tpl = readFileSync(join(TEMPLATES_DIR, "post.html"), "utf8");
  const html = fill(tpl, {
    w, h, lang: brand.voice?.language || "en", layout, outline: outline ? "outline-cta" : "",
    surface, text: t.colors?.text || "#111", accent, accentInk, secondary: t.colors?.secondary || "#f2f2f2",
    radius: t.radius || "8px", displayFont: fonts.display, bodyFont: fonts.body, fontCss: fonts.css,
    image: dataUrl(opts.image),
    // The type layout has no photo to anchor recognition, so its mark rides in the eyebrow lockup
    // instead of a corner; every other layout keeps the corner placement.
    logo: layout === "type" ? "" : mark, lockup, eyerow: opts.eyebrow || lockup,
    headline: opts.headline, sub: opts.sub, eyebrow: opts.eyebrow, cta: opts.cta, counter: opts.counter,
  });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.context().route('**/*', routePublic);
    await page.routeWebSocket('**/*', socket => socket.close());
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // The headline is sized top-down from the frame's void (its block top must sit at 30-48% of canvas
    // height), and the sub follows at a quarter of it, floored at the 3% legibility minimum. Sizing the sub
    // first instead forces a headline so large it wraps past the void, so the two passes settle in that order.
    const metrics = await page.evaluate(({ w, h }) => {
      const q = (s) => document.querySelector(s);
      const h1 = q("h1"); if (!h1) return;
      const box = h1.parentElement, eb = q(".eyebrow"), subEl = q("p.sub");
      const small = Math.round(w * 0.03);
      for (const el of [eb, q(".pill")]) if (el) el.style.fontSize = small + "px";
      // Margins sit well below the target ink gaps: each ink gap also carries both elements' half-leading,
      // which measured ~0.25x the headline line-height, so every margin is the target gap minus that.
      const apply = (fs) => {
        const lh = fs * 1.06;
        h1.style.fontSize = fs + "px";
        h1.style.marginBottom = lh * 0.43 + "px";
        if (eb) eb.style.marginBottom = lh * 0.055 + "px";
        if (subEl) subEl.style.marginBottom = lh * 1.35 + "px";
      };
      // A bottom-anchored copy block has no height of its own, so the void above it is the real constraint.
      const over = () => box.getBoundingClientRect().top < h * 0.36 || box.scrollHeight > box.clientHeight + 1;
      const settle = (sub) => {
        if (subEl) subEl.style.fontSize = sub + "px";
        let fs = w * 0.15, guard = 40;
        apply(fs);
        while (guard-- && fs > small * 3.5 && over()) { fs = Math.max(small * 3.5, fs * 0.94); apply(fs); }
        return fs;
      };
      // Cap-height inference is how a critic measures the ratio and it reads a few percent low, so the
      // nominal 4:1 keeps the measured value inside the 3.5-4.5 band; the sub never drops below the floor.
      const sub = Math.min(Math.max(Math.round(settle(small) / 4), small), Math.round(small * 1.3));
      settle(sub);
      // The gap bands are checked ink to ink, so report the measured ones rather than the margins set.
      const lh = parseFloat(h1.style.fontSize) * 1.06, r = (el) => el.getBoundingClientRect();
      const g = (a, b) => (a && b ? ((r(b).top - r(a).bottom) / lh).toFixed(2) : "n/a");
      return { headlineTopPct: ((r(box).top + (eb ? r(eb).height : 0)) / h * 100).toFixed(1),
        gaps: [g(eb, h1), g(h1, subEl), g(subEl, q(".pill")?.parentElement)], lh: Math.round(lh) };
    }, { w, h });
    if (process.env.CADENCE_RENDER_METRICS) console.error("[render metrics]", JSON.stringify(metrics));
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
