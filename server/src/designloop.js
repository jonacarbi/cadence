// Gauntlet loop (design-loop skill) on the brand's hero frame: build → render → three critics in fresh contexts
// (Brief/sonnet, System/haiku against design-system.md, Craft/opus against bar.md) → apply fixes to the brand
// tokens → repeat. Runs once per brand after extraction, before design-dna codifies the final look.
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { update, logEvent, getSetting } from './db.js';
import { registerJob } from './jobs.js';
import { claude, completeJson } from './llm.js';
import { renderFrame, LAYOUTS } from './render.js';
import { generateImage } from './images.js';
import { stylePrompt } from './brands.js';
import { getBrand } from './brands.js';

const readOnly = { agentic: true, args: ['--allowedTools', 'Read'] };
const verdict = (text) => /VERDICT:\s*PASS/i.test(text);
const BRIEF = 'Make a scroll-stopping Instagram post for this brand that a follower recognizes as the brand within one second.';

async function tearDown(brand, dir) {
  const bar = join(dir, 'bar.md');
  if (existsSync(bar)) return bar;
  // The bar must only ask for what this pipeline can change, or every round fails on elements the template has no slot for.
  const text = await claude(`Read the reference screenshot at ${join(brand.dir, 'reference.png')}. Tear its visual language down into 8–15 checkable mechanisms for a 1080x1350 social frame: type scale ratios, colour usage counts, margins as % of canvas, alignment, one accent rule, contrast.
The frame being judged contains exactly these elements and nothing else: an eyebrow line, a headline of 1–4 lines, a sub line, a CTA pill, an optional full-width photo, and an optional accent rule. The only things adjustable are the colour tokens (surface, text, accent, secondary), the two fonts, the corner radius, light/dark mode, and which of the ${LAYOUTS.join('/')} layouts is used.
So write every mechanism so it can be checked against that frame and fixed by those knobs. Never ask for product cards, code tokens, navigation, screenshots, logos, meta lines or any element from the list above that the frame does not have. No adjectives. Output the bar as a markdown list only.`, { ...readOnly, model: 'opus' });
  writeFileSync(bar, text); return bar;
}

async function judge(frame, brand, bar, dir) {
  const [brief, system, craft] = await Promise.all([
    claude(`Read the image ${frame}. Brief: "${BRIEF}". Does this frame achieve the brief? Ignore aesthetics. Reply "VERDICT: PASS" or "VERDICT: FAIL" then numbered concrete fixes.`, { ...readOnly, model: 'sonnet' }),
    claude(`Read the image ${frame} and the design system at ${join(brand.dir, 'design-system.md')}. Mechanically list every violation of the system with the rule it breaks. Reply "VERDICT: PASS" or "VERDICT: FAIL" then numbered violations.`, { ...readOnly, model: 'haiku' }),
    claude(`Read the image ${frame} and the bar at ${bar}. For each bar line answer PASS/FAIL with what you see. Then "VERDICT: PASS" only if every line passes, else "VERDICT: FAIL" and numbered fixes.`, { ...readOnly, model: 'opus' }),
  ]);
  writeFileSync(join(dir, 'critics.md'), `# Brief\n${brief}\n\n# System\n${system}\n\n# Craft\n${craft}\n`);
  return { pass: verdict(brief) && verdict(system) && verdict(craft), notes: [brief, system, craft].filter((t) => !verdict(t)).join('\n\n') };
}

export async function runDesignLoop(brandId, report = () => {}) {
  const brand = getBrand(brandId);
  if (!brand || !existsSync(join(brand.dir, 'reference.png'))) throw new Error('Brand has no reference screenshot yet');
  const root = join(brand.dir, 'design-loop'); mkdirSync(root, { recursive: true });
  const rounds = Number(getSetting('design_loop_rounds', '3'));
  const bar = await tearDown(brand, root);
  let tokens = brand.tokens, layout = 'editorial', summary = '';
  // Same pipeline as real posts: one OpenAI image in the brand's style. Without it, the type-only layout is judged.
  let image = null;
  try {
    report(0.05, 'Generating the hero image');
    image = await generateImage(`Hero image for ${brand.name}: ${brand.voice?.summary || brand.voice?.tagline || 'the brand'}.\n\nStyle notes: ${stylePrompt(brand).slice(0, 1200)}\n\nUltra high quality, editorial photography, natural light. No text, no lettering, no logos, no watermarks.`, { aspect: 'portrait', brandSlug: brand.slug });
  } catch (e) { logEvent('warn', 'design.loop', `${brand.name}: no hero image (${e.message}); judging type-only layout`, { id: brandId }); layout = 'type'; }
  for (let r = 1; r <= rounds; r++) {
    const dir = join(root, `round-${r}`); mkdirSync(dir, { recursive: true });
    const frame = await renderFrame({ brand: { ...brand, tokens }, aspect: 'portrait', layout, eyebrow: brand.name, headline: brand.voice?.tagline || `This is ${brand.name}`, sub: brand.voice?.summary || brand.voice?.tagline || `What ${brand.name} is for, in one line.`, cta: 'Learn more', image });
    copyFileSync(frame, join(dir, 'hero.png'));
    const { pass, notes } = await judge(join(dir, 'hero.png'), brand, bar, dir);
    summary = `R${r} · ${pass ? 'all PASS' : 'FAIL'}`; report(0.05 + 0.9 * r / rounds, summary); logEvent('info', 'design.loop', `${brand.name}: ${summary}`, { id: brandId });
    if (pass) break;
    // Builder: the template is fixed; tokens + layout choice are the design.
    const next = await completeJson(`You are fixing a social post design for ${brand.name}. Current tokens: ${JSON.stringify(tokens)}. Current layout: "${layout}" (options: ${LAYOUTS.join(', ')}; "type" has no photo).
Critic notes:\n${notes.slice(0, 6000)}\nReturn JSON {"tokens": <full updated tokens with the same shape ({colors:{surface,text,accent,secondary,palette},fonts:{display,body},radius,mode})>, "layout": "<one of the options>"}. Only change what the critics asked for; keep the brand's real colours and fonts.`, { model: 'opus' });
    if (next?.tokens?.colors && next?.tokens?.fonts) { tokens = next.tokens; writeFileSync(join(dir, 'tokens.json'), JSON.stringify(tokens, null, 2)); }
    if (LAYOUTS.includes(next?.layout) && (image || next.layout === 'type')) layout = next.layout;
  }
  tokens = { ...tokens, preferred_layout: layout };
  update('brands', brandId, { tokens_json: JSON.stringify(tokens) });
  writeFileSync(join(brand.dir, 'tokens.json'), JSON.stringify(tokens, null, 2));
  return { summary, tokens };
}
registerJob('design-loop', runDesignLoop);
