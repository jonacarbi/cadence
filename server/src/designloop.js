// Gauntlet loop (design-loop skill) on the brand's hero frame: build → render → three critics in fresh contexts
// (Brief, System against design-system.md, Craft against bar.md; all on LLM_MODEL = Sonnet 5.5) → apply fixes to the brand
// tokens → repeat. Runs once per brand after extraction, before design-dna codifies the final look.
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { update, logEvent, getSetting } from './db.js';
import { registerJob } from './jobs.js';
import { claude, completeJson } from './llm.js';
import { renderFrame, LAYOUTS, contrastFix } from './render.js';
import { generateImage } from './images.js';
import { stylePrompt, syncDesignSystemMd } from './brands.js';
import { resolveFonts } from './fonts.js';
import { getBrand } from './brands.js';
import { agentConfig, fileScope } from './agents.js';

// Critics see only the brand folder (screenshot, design-system.md, the rounds), nothing else on disk.
const readOnly = (brand) => ({ agentic: true, args: fileScope({ read: [brand.dir] }), timeout: 20 * 60_000 });
const critic = (p, o) => claude(p, o).catch((e) => `VERDICT: FAIL\nCritic did not answer: ${e.message}`);
const verdict = (text) => /VERDICT:\s*PASS/i.test(text);
const BRIEF = 'Make a scroll-stopping Instagram post for this brand that a follower recognizes as the brand within one second.';

const KNOBS = `The frame contains an eyebrow line, a headline of 1-4 lines, a sub line, a CTA pill and an optional full-width photo, and nothing else. The only adjustable things are the colour tokens (surface, text, accent, secondary), the two fonts, the corner radius, light/dark mode, and which of the ${LAYOUTS.join('/')} layouts is used. There is no gradient, texture, glow, pattern, screenshot or free-form shape to add, and the logo is a fixed file composited at one size.`;

async function tearDown(brand, dir) {
  const bar = join(dir, 'bar.md');
  if (existsSync(bar)) return bar;
  // The bar must only ask for what this pipeline can change, or every round fails on elements the template has no slot for.
  const text = await claude(`Read the reference screenshot at ${join(brand.dir, 'reference.png')}. Tear its visual language down into 8–15 checkable mechanisms for a 1080x1350 social frame: type scale ratios, colour usage counts, margins as % of canvas, alignment, one accent rule, contrast.
The frame being judged contains exactly these elements and nothing else: an eyebrow line, a headline of 1–4 lines, a sub line, a CTA pill, and an optional full-width photo. The only things adjustable are the colour tokens (surface, text, accent, secondary), the two fonts, the corner radius, light/dark mode, and which of the ${LAYOUTS.join('/')} layouts is used.
So write every mechanism so it can be checked against that frame and fixed by those knobs. Never ask for product cards, code tokens, navigation, screenshots, logos, meta lines or any element from the list above that the frame does not have. No adjectives. Output the bar as a markdown list only.`, readOnly(brand));
  writeFileSync(bar, text); return bar;
}

// The offer sentence is a paragraph, and a truncated headline reads as broken copy to the Brief critic,
// so the frame gets a real post line written once per brand and reused across rounds.
async function heroCopy(brand, root) {
  const file = join(root, 'hero-copy.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const v = brand.voice || {};
  const fallback = { headline: `This is ${brand.name}`, sub: v.tone || `What ${brand.name} is for.` };
  const copy = await completeJson(`Brand: ${brand.name}. Offer: ${v.offer || ''}. Audience: ${v.audience || ''}. Tone: ${v.tone || ''}.
Write the copy for one Instagram post that states what this brand does. Return JSON {"headline":"max 22 characters, no trailing punctuation","sub":"max 55 characters, one complete sentence"}.`).catch(() => null);
  const out = copy?.headline && copy?.sub ? { headline: String(copy.headline).slice(0, 30), sub: String(copy.sub).slice(0, 70) } : fallback;
  writeFileSync(file, JSON.stringify(out, null, 2));
  return out;
}

// The renderer resolves fonts and lifts a low-contrast accent; tokens that skip those steps describe a
// frame nobody renders. Run the same resolution here so the doc, the critics and the pixels agree.
// The doc is read from the brand row, so the row has to move first.
function publish(brandId, tokens) {
  update('brands', brandId, { tokens_json: JSON.stringify(tokens) });
  syncDesignSystemMd(brandId);
}

async function effectiveTokens(t) {
  const f = await resolveFonts(t);
  return { ...t, colors: { ...t.colors, accent: contrastFix(t.colors?.accent, t.colors?.surface) }, fonts: { ...t.fonts, display: f.display, body: f.body } };
}

async function judge(frame, brand, bar, dir) {
  const [brief, system, craft] = await Promise.all([
    critic(`Read the image ${frame}. Brief: "${BRIEF}". Does this frame achieve the brief? Ignore aesthetics.\n${KNOBS}\nJudge only what those knobs reach, and never fail the frame for an element it has no slot for. Reply "VERDICT: PASS" or "VERDICT: FAIL" then numbered concrete fixes.`, readOnly(brand)),
    critic(`Read the image ${frame} and the design system at ${join(brand.dir, 'design-system.md')}. List every violation of the system with the rule it breaks. Judge only what is visible without measuring: the fonts, the palette and its roles, the bans, one idea per frame. Every rule stated as a size, a ratio, a percentage of canvas or a contrast figure is measured by another critic against a stricter bar, so skip those here rather than estimating them, and never call a colour by name off the rendering. Reply "VERDICT: PASS" or "VERDICT: FAIL" then numbered violations.`, readOnly(brand)),
    critic(`Read the image ${frame} and the bar at ${bar}. For each bar line answer PASS/FAIL with what you see. Then "VERDICT: PASS" only if every line passes, else "VERDICT: FAIL" and numbered fixes.`, readOnly(brand)),
  ]);
  writeFileSync(join(dir, 'critics.md'), `# Brief\n${brief}\n\n# System\n${system}\n\n# Craft\n${craft}\n`);
  return { pass: verdict(brief) && verdict(system) && verdict(craft), notes: [brief, system, craft].filter((t) => !verdict(t)).join('\n\n') };
}

export async function runDesignLoop(brandId, report = () => {}) {
  const brand = getBrand(brandId);
  if (!brand || !existsSync(join(brand.dir, 'reference.png'))) throw new Error('Brand has no reference screenshot yet');
  // The critics read the rendered PNG, which needs Claude Code's Read tool; locked mode and other agents have none.
  const cfg = agentConfig();
  if (cfg.provider !== 'claude' || cfg.context === 'locked') { report(`skipped: the design loop needs Claude Code in full context (active: ${cfg.provider}/${cfg.context})`); return { skipped: true }; }
  const root = join(brand.dir, 'design-loop'); mkdirSync(root, { recursive: true });
  // A run that converges early leaves the later rounds of the previous run on disk, which reads as
  // this run having failed them.
  for (const d of readdirSync(root).filter((f) => f.startsWith('round-'))) rmSync(join(root, d), { recursive: true, force: true });
  const rounds = Number(getSetting('design_loop_rounds', '3'));
  const bar = await tearDown(brand, root);
  const copy = await heroCopy(brand, root);
  // Both critics read design-system.md against the pixels, so the doc has to describe this round's frame:
  // the fonts the machine actually has and the accent after the renderer's contrast lift. The brand's
  // licensed originals stay on record under fonts.requested.
  const original = brand.tokens?.fonts?.requested || brand.tokens?.fonts;
  let tokens = await effectiveTokens({ ...brand.tokens, fonts: { ...brand.tokens?.fonts, requested: original } });
  let layout = 'editorial', summary = '';
  publish(brandId, tokens);
  // Same pipeline as real posts: one OpenAI image in the brand's style. Without it, the type-only layout is judged.
  let image = null;
  try {
    report(0.05, 'Generating the hero image');
    image = await generateImage(`Hero image for ${brand.name}: ${brand.voice?.offer || brand.name}.\n\nStyle notes: ${stylePrompt(brand).slice(0, 1200)}\n\nUltra high quality, editorial photography, natural light. No text, no lettering, no logos, no watermarks.`, { aspect: 'portrait', brandSlug: brand.slug });
  } catch (e) { logEvent('warn', 'design.loop', `${brand.name}: no hero image (${e.message}); judging type-only layout`, { id: brandId }); layout = 'type'; }
  for (let r = 1; r <= rounds; r++) {
    const dir = join(root, `round-${r}`); mkdirSync(dir, { recursive: true });
    const frame = await renderFrame({ brand: { ...brand, tokens }, aspect: 'portrait', layout, eyebrow: brand.name, headline: copy.headline, sub: copy.sub, cta: 'Learn more', image });
    copyFileSync(frame, join(dir, 'hero.png'));
    const { pass, notes } = await judge(join(dir, 'hero.png'), brand, bar, dir);
    summary = `R${r} · ${pass ? 'all PASS' : 'FAIL'}`; report(0.05 + 0.9 * r / rounds, summary); logEvent('info', 'design.loop', `${brand.name}: ${summary}`, { id: brandId });
    if (pass) break;
    // Builder: the template is fixed; tokens + layout choice are the design.
    const next = await completeJson(`You are fixing a social post design for ${brand.name}. Current tokens: ${JSON.stringify(tokens)}. Current layout: "${layout}" (options: ${LAYOUTS.join(', ')}; "type" has no photo).
Critic notes:\n${notes.slice(0, 6000)}\nReturn JSON {"tokens": <full updated tokens with the same shape ({colors:{surface,text,accent,secondary,palette},fonts:{display,body},radius,mode})>, "layout": "<one of the options>"}. Only change what the critics asked for; keep the brand's real colours and fonts.`);
    if (next?.tokens?.colors && next?.tokens?.fonts) {
      // The builder answers with the knobs only; everything measured at extraction (palette, heading styles,
      // the requested fonts) is evidence, not a knob, so merge onto the current tokens instead of replacing them.
      tokens = await effectiveTokens({ ...tokens, ...next.tokens, colors: { ...tokens.colors, ...next.tokens.colors }, fonts: { ...tokens.fonts, ...next.tokens.fonts, requested: original } });
      publish(brandId, tokens);
      writeFileSync(join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2));
    }
    if (LAYOUTS.includes(next?.layout) && (image || next.layout === 'type')) layout = next.layout;
  }
  tokens = { ...tokens, preferred_layout: layout };
  update('brands', brandId, { tokens_json: JSON.stringify(tokens) });
  writeFileSync(join(brand.dir, 'tokens.json'), JSON.stringify(tokens, null, 2));
  syncDesignSystemMd(brandId);
  return { summary, tokens };
}
registerJob('design-loop', runDesignLoop);
