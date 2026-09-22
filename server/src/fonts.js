// A render must use the brand's real type, or design-system.md documents a font the pixels never show.
// Families already on the machine render as-is; anything else is fetched once from Google Fonts and cached
// as an inlined @font-face, because setContent pages have an opaque origin and cannot load remote CSS.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { APP_DIR } from './config.js';
import { fetchPublic } from './network.js';

const CACHE = join(APP_DIR, 'fonts');
const WEIGHTS = '400;600;700';
// Google Fonts is best effort: fonts.gstatic.com is unreachable on some networks, so a miss must be cheap.
const NET_TIMEOUT = 4000;
// What a frame really falls back to when a brand's licensed face is not on the machine.
const LOCAL_SANS = ['Inter', 'Helvetica Neue', 'SF Pro Text', 'Arial'];
const LOCAL_MONO = ['JetBrains Mono', 'SF Mono', 'Menlo', 'Fira Code', 'Courier New'];
// Chrome's UA is what makes the CSS2 endpoint answer with woff2 instead of ttf.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const memo = new Map();

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let families = null;
function localFamilies() {
  if (families) return families;
  try { families = new Set(execFileSync('fc-list', [':', 'family'], { encoding: 'utf8' }).split(/[\n,]/).map((f) => f.trim().toLowerCase())); }
  catch { families = new Set(); }
  return families;
}

async function googleFace(family) {
  const css = await fetchPublic(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${WEIGHTS}&display=swap`, { headers: { 'user-agent': UA }, timeout: NET_TIMEOUT });
  if (css.status !== 200) return null;
  // The reply carries every unicode subset (~20 files per weight). Only the latin ranges are ever set in a frame,
  // and inlining the rest would add megabytes of base64 to each render.
  const blocks = css.body.toString('utf8').split('@font-face').slice(1)
    .map((b) => '@font-face' + b.slice(0, b.indexOf('}') + 1))
    .filter((b) => /U\+0000-00FF|U\+0100-02(AF|FF)/.test(b));
  const out = [];
  for (const block of blocks) {
    const url = block.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/)?.[0];
    if (!url) continue;
    const file = await fetchPublic(url, { headers: { 'user-agent': UA }, timeout: NET_TIMEOUT }).catch(() => null);
    if (file?.status === 200) out.push(block.replace(url, `data:font/woff2;base64,${file.body.toString('base64')}`));
  }
  return out.length ? out.join('\n') : null;
}

/**
 * Resolve one token font to a family that will actually render, and the @font-face needed to render it.
 * A licensed face nobody has installed silently becomes the CSS fallback, so the resolved name is what
 * gets written back to the brand tokens — design-system.md then describes the pixels, not the wish.
 */
export async function resolveFont(requested, mono = false) {
  const name = String(requested || '').trim() || (mono ? LOCAL_MONO[0] : LOCAL_SANS[0]);
  if (memo.has(name)) return memo.get(name);
  const answer = async () => {
    const local = localFamilies();
    // "Inter Display" and "Berkeley Mono" are not Google families; the base name often is.
    const generics = mono || /mono/i.test(name) ? LOCAL_MONO : LOCAL_SANS;
    for (const candidate of [...new Set([name, name.split(/\s+/)[0], ...generics])].filter(Boolean)) {
      if (local.has(candidate.toLowerCase())) return { family: candidate, css: '' };
      mkdirSync(CACHE, { recursive: true });
      const cached = join(CACHE, `${slug(candidate)}.css`);
      if (existsSync(cached)) return { family: candidate, css: readFileSync(cached, 'utf8') };
      // Misses are cached too: on a network that cannot reach fonts.gstatic.com every lookup costs a timeout.
      const miss = join(CACHE, `${slug(candidate)}.miss`);
      if (existsSync(miss)) continue;
      const css = await googleFace(candidate).catch(() => null);
      if (css) { writeFileSync(cached, css); return { family: candidate, css }; }
      writeFileSync(miss, '');
    }
    return { family: name, css: '' };
  };
  const out = await answer();
  memo.set(name, out);
  return out;
}

/** Resolve both token fonts at once. Returns { display, body, css }. */
export async function resolveFonts(tokens) {
  const [display, body] = await Promise.all([resolveFont(tokens?.fonts?.display), resolveFont(tokens?.fonts?.body)]);
  return { display: display.family, body: body.family, css: [display.css, body.css].filter(Boolean).join('\n') };
}
