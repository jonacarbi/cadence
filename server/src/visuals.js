// Visual production for a post: OpenAI image (once, cached in assets.raw) → composed frame(s) in the brand's
// design system. Resumable: a re-run skips paid generation when the raw image already exists.
import { one, all, update, hydrate, logEvent } from './db.js';
import { registerJob, enqueue } from './jobs.js';
import { generateImage } from './images.js';
import { renderFrame, renderCarousel, LAYOUTS } from './render.js';
import { lintPost } from './lint.js';
import { getBrand, stylePrompt } from './brands.js';
import { META } from './providers/registry.js';

const wantsPortrait = (platforms) => platforms.some((p) => META[p]?.aspect === 'portrait');

export async function producePost(postId, report = () => {}) {
  const post = hydrate(one('SELECT * FROM posts WHERE id = ?', postId));
  if (!post) throw new Error('Post not found');
  if (post.format === 'text') return post;
  const brand = getBrand(post.brand_id);
  const a = post.assets || {};
  const aspect = post.format === 'carousel' ? 'square' : wantsPortrait(post.platforms) ? 'portrait' : 'square';
  let raw = a.raw;
  if (!raw) {
    report(0.1, `Generating image: ${post.topic}`);
    const style = stylePrompt(brand).slice(0, 1200);
    raw = await generateImage(`${post.image_prompt}\n\nStyle notes: ${style}\n\nUltra high quality, editorial photography, natural light. No text, no lettering, no logos, no watermarks.`, { aspect, brandSlug: brand.slug });
    update('posts', postId, { assets_json: JSON.stringify({ ...a, raw, aspect }) });
  }
  report(0.6, 'Composing in the design system');
  const base = { brand, image: raw, headline: a.headline || post.topic, sub: a.sub, eyebrow: a.eyebrow, cta: a.cta };
  const layout = LAYOUTS.includes(a.layout) ? a.layout : 'editorial';
  let frames, square = null;
  if (post.format === 'carousel' && a.slides?.length) {
    frames = await renderCarousel({ brand, slides: a.slides.map((s, i) => ({ ...s, eyebrow: i === 0 ? a.eyebrow : '', cta: a.cta })), image: raw });
  } else {
    frames = [await renderFrame({ ...base, aspect, layout })];
    if (aspect === 'portrait' && post.platforms.some((p) => META[p]?.aspect === 'square')) square = await renderFrame({ ...base, aspect: 'square', layout });
  }
  const lint = await lintPost(post.copy);
  update('posts', postId, { image_path: frames[0], assets_json: JSON.stringify({ ...a, raw, aspect, layout, frames, square }), lint_json: JSON.stringify(lint) });
  return hydrate(one('SELECT * FROM posts WHERE id = ?', postId));
}

/** Produce visuals for every post of a campaign, one at a time, then mark the campaign for review. */
export async function produceCampaign(campaignId, report = () => {}) {
  const posts = all("SELECT id, topic, image_path, format FROM posts WHERE campaign_id = ? AND status = 'draft' ORDER BY scheduled_at", campaignId);
  const failed = [];
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (p.image_path || p.format === 'text') continue;
    report(i / Math.max(1, posts.length), `Visual ${i + 1}/${posts.length}: ${p.topic}`);
    try { await producePost(p.id); } catch (e) { failed.push(p.topic); update('posts', p.id, { error: `visual: ${e.message}` }); logEvent('warn', 'visual.failed', `${p.topic}: ${e.message}`, { id: p.id }); }
  }
  update('campaigns', campaignId, { status: 'review' });
  logEvent('info', 'campaign.review', `${posts.length - failed.length}/${posts.length} posts ready for review`, { campaignId, failed });
  if (failed.length === posts.length && posts.length) throw new Error(`No visuals could be produced: ${failed[0]}`);
}

/** Re-render after an edit (new headline/layout) without paying for a new image; `fresh` discards the image too. */
export function requeueVisual(postId, { fresh = false } = {}) {
  const post = hydrate(one('SELECT * FROM posts WHERE id = ?', postId));
  if (!post) throw new Error('Post not found');
  const a = post.assets || {};
  update('posts', postId, { image_path: null, assets_json: JSON.stringify(fresh ? { ...a, raw: null, frames: [], square: null } : a) });
  return enqueue('post-visual', postId);
}

registerJob('post-visual', producePost);
registerJob('campaign-visuals', produceCampaign);
