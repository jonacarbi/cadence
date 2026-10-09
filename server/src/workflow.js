import { db, one, all, insert, update, hydrate, now } from './db.js';
import { lintCaption, hasBlockers } from './lint.js';
import { PLATFORMS } from './providers/index.js';
import { jitterMs, duplicateTextWarnings } from './safety.js';

export class WorkflowError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
let transactionDepth = 0;
export function transaction(fn) {
  const nested = transactionDepth > 0, savepoint = `cadence_${transactionDepth}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  transactionDepth++;
  try { const result = fn(); db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT'); return result; }
  catch (error) { db.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK'); if (nested) db.exec(`RELEASE ${savepoint}`); throw error; }
  finally { transactionDepth--; }
}
export function postById(id) {
  const post = hydrate(one('SELECT * FROM posts WHERE id = ?', id));
  if (!post) throw new WorkflowError('Post not found', 404);
  return post;
}
function validateContent(input) {
  if (!Array.isArray(input.platforms) || !input.platforms.length || new Set(input.platforms).size !== input.platforms.length)
    throw new WorkflowError('Choose at least one unique platform');
  if (!input.copy || typeof input.copy !== 'object' || Array.isArray(input.copy)) throw new WorkflowError('Captions are required');
  for (const platform of input.platforms) {
    if (!PLATFORMS[platform]) throw new WorkflowError(`Unknown platform: ${platform}`);
    if (typeof input.copy[platform] !== 'string' || !input.copy[platform].trim()) throw new WorkflowError(`Caption required for ${platform}`);
  }
  if (typeof input.scheduled_at !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(input.scheduled_at) || !Number.isFinite(Date.parse(input.scheduled_at)))
    throw new WorkflowError('Schedule must be an ISO date with a timezone');
}
// frames/square/raw are file paths the renderer writes; a client or agent never sets them, or a draft could attach any file.
const MEDIA_KEYS = ['frames', 'square', 'raw'];
const textAssets = (a) => (a && typeof a === 'object' && !Array.isArray(a) ? Object.fromEntries(Object.entries(a).filter(([k]) => !MEDIA_KEYS.includes(k))) : {});
export function createPost(input, actor = 'agent') {
  validateContent(input);
  if (!one('SELECT id FROM brands WHERE id = ?', input.brand_id)) throw new WorkflowError('Brand not found', 404);
  if (input.campaign_id && !one('SELECT id FROM campaigns WHERE id = ? AND brand_id = ?', input.campaign_id, input.brand_id))
    throw new WorkflowError('Campaign belongs to another brand or does not exist');
  const id = insert('posts', {
    brand_id: input.brand_id, campaign_id: input.campaign_id || null,
    scheduled_at: new Date(input.scheduled_at).toISOString(),
    platforms_json: JSON.stringify(input.platforms), copy_json: JSON.stringify(input.copy),
    topic: String(input.topic || ''), pillar: String(input.pillar || ''),
    image_prompt: String(input.image_prompt || ''), alt_text: String(input.alt_text || ''),
    format: ['single', 'carousel', 'text'].includes(input.format) ? input.format : 'single',
    assets_json: JSON.stringify(textAssets(input.assets)),
    design_system_id: input.design_system_id || null,
    status: 'draft', drafted_by: actor,
  });
  return postById(id);
}
function checkVersion(post, version) {
  if (!Number.isInteger(version) || post.version !== version) throw new WorkflowError('This post changed. Reload before continuing.', 409);
}
export function editPost(id, input, version) {
  return transaction(() => {
    const post = postById(id); checkVersion(post, version);
    if (['publishing', 'published', 'uncertain'].includes(post.status)) throw new WorkflowError('This post cannot be edited in its current state', 409);
    const next = { ...post, ...input }; validateContent(next);
    update('posts', id, {
      scheduled_at: new Date(next.scheduled_at).toISOString(), copy_json: JSON.stringify(next.copy),
      platforms_json: JSON.stringify(next.platforms), topic: String(next.topic || ''),
      alt_text: String(next.alt_text || ''), tags: String(next.tags || ''), image_prompt: String(next.image_prompt || ''),
      assets_json: JSON.stringify(input.assets && typeof input.assets === 'object' ? textAssets(input.assets) : post.assets || {}),
      status: 'draft', approved_by: null, version: post.version + 1, error: null,
    });
    return postById(id);
  });
}
export function approvePost(id, version, actor) {
  if (!actor || actor === 'agent') throw new WorkflowError('Human approval is required', 403);
  return transaction(() => {
    const post = postById(id); checkVersion(post, version);
    if (!['draft', 'rejected'].includes(post.status)) throw new WorkflowError('Only drafts can be approved', 409);
    validateContent(post);
    const issues = post.platforms.flatMap(p => lintCaption(post.copy[p], p));
    for (const platform of post.platforms) {
      if (PLATFORMS[platform].requiresMedia && !post.image_path) issues.push({severity:'block', platform, message:'Media is required'});
      if(post.image_path && PLATFORMS[platform].maxMediaChars && [...post.copy[platform]].length>PLATFORMS[platform].maxMediaChars)issues.push({severity:'block',platform,message:`${platform} media captions allow ${PLATFORMS[platform].maxMediaChars} characters`});
    }
    if (hasBlockers(issues)) throw new WorkflowError(issues.filter(i => i.severity === 'block').map(i => i.message).join('; '));
    update('posts', id, { status: 'approved', approved_by: actor, lint_json: JSON.stringify(issues) });
    return postById(id);
  });
}
export function rejectPost(id, version, actor) {
  if (!actor || actor === 'agent') throw new WorkflowError('Human review is required', 403);
  return transaction(() => {
    const post = postById(id); checkVersion(post, version);
    if (!['draft', 'approved', 'scheduled', 'rejected'].includes(post.status)) throw new WorkflowError('Post cannot be rejected now', 409);
    update('posts', id, { status: 'rejected', approved_by: null, version: post.version + 1 });
    return postById(id);
  });
}
export function schedulePost(id, version, accountIds) {
  return transaction(() => {
    const post = postById(id); checkVersion(post, version);
    if (post.status !== 'approved' || !post.approved_by) throw new WorkflowError('Approve the current draft before scheduling', 409);
    if (Date.parse(post.scheduled_at) <= Date.now()) throw new WorkflowError('Choose a future publishing time');
    if (!Array.isArray(accountIds) || !accountIds.length || new Set(accountIds).size !== accountIds.length) throw new WorkflowError('Choose unique connected accounts');
    const accounts = accountIds.map(a => one('SELECT * FROM accounts WHERE id = ? AND brand_id = ?', a, post.brand_id));
    if (accounts.some(a => !a || a.paused || !post.platforms.includes(a.platform))) throw new WorkflowError('Account is missing, paused, or belongs to a different brand/platform');
    if (post.platforms.some(p => !accounts.some(a => a.platform === p))) throw new WorkflowError('Every platform needs a destination account');
    // Jitter delays each delivery by 0..jitter_minutes AFTER the approved time, so a batch never fires on the same second.
    // A reschedule (missed, edited) only re-queues destinations that never got the post: a receipt from any version counts.
    const sent = new Set(all(`SELECT account_id FROM deliveries WHERE post_id = ? AND status IN ('publishing','published','uncertain')`, id).map((d) => d.account_id));
    const pending = accounts.filter((a) => !sent.has(a.id));
    if (!pending.length) throw new WorkflowError('Every chosen account already has this post.', 409);
    for (const account of pending) insert('deliveries', { post_id: id, account_id: account.id, version: post.version, status: 'queued', next_attempt_at: new Date(Date.parse(post.scheduled_at) + jitterMs()).toISOString() });
    update('posts', id, { status: 'scheduled' });
    return Object.assign(postById(id), { warnings: duplicateTextWarnings(post, accounts) });
  });
}
export function listPosts(brandId) {
  return all('SELECT * FROM posts WHERE brand_id = ? ORDER BY scheduled_at', brandId).map(hydrate);
}
