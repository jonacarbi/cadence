// Second route table: brands-from-URL, OAuth, accounts, settings, comments, regenerate, assets, analytics, rules.
import { randomUUID } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { mkdirSync, existsSync, createReadStream, realpathSync, statSync } from 'node:fs';
import { all, one, insert, update, hydrate, run, getSetting, setSetting } from './db.js';
import { BRANDS_DIR, ASSETS_DIR } from './config.js';
import { WorkflowError, postById, approvePost, schedulePost, editPost, transaction } from './workflow.js';
import { PLATFORMS } from './providers/index.js';
import { META } from './providers/registry.js';
import { startUrl, finish, addManualAccount } from './oauth.js';
import { enqueue } from './jobs.js';
import { requeueVisual } from './visuals.js';
import { LEVELS, setAutonomy, autonomy } from './autonomy.js';
import { analyticsFor } from './analytics.js';
import { completeJson } from './llm.js';
import { getBrand, slugify } from './brands.js';
import { loadRules, saveRules } from './lint.js';
import { importMedia, listMedia, deleteMedia, setPostMedia } from './library.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown', '.json': 'application/json' };
const SETTINGS = ['autonomy', 'cap_per_account_per_day', 'webhook_url', 'webhook_secret', 'timezone', 'design_loop', 'design_loop_rounds', 'auto_plan'];

function parseSite(url) {
  let site; try { site = new URL(url); } catch { throw new WorkflowError('A valid website URL is required'); }
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) throw new WorkflowError('Use an HTTP or HTTPS website without credentials');
  return site;
}
export function createBrandFromUrl(body) {
  const site = parseSite(body.url);
  const existing = one('SELECT * FROM brands WHERE url = ?', site.origin);
  if (existing) return { status: 200, brand: hydrate(existing) };
  const name = (typeof body.name === 'string' && body.name.trim()) ? body.name.trim().slice(0, 150) : site.hostname.replace(/^www\./, '');
  const slug = `${slugify(name).slice(0, 50)}-${randomUUID().slice(0, 8)}`;
  const dir = join(BRANDS_DIR, slug); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = insert('brands', { name, slug, url: site.origin, dir, status: 'extracting' });
  enqueue('brand-extract', id);
  return { status: 202, brand: hydrate(one('SELECT * FROM brands WHERE id = ?', id)) };
}

/** Approve and schedule in one step; defaults to every connected, unpaused account on the post's platforms. */
export function approveAndSchedule(id, version, actor, accountIds) {
 return transaction(() => {
  const approved = approvePost(id, version, actor);
  const ids = Array.isArray(accountIds) && accountIds.length ? accountIds
    : approved.platforms.flatMap((p) => all('SELECT id FROM accounts WHERE brand_id = ? AND platform = ? AND paused = 0', approved.brand_id, p).map((a) => a.id));
  if (!ids.length) return approved; // approved, not scheduled: no accounts yet
  return schedulePost(id, approved.version, ids);
 });
}

async function regenerate(id, body, actor) {
  const post = postById(id);
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 2000) : '';
  if (feedback) insert('comments', { post_id: id, author: actor, body: feedback });
  const brand = getBrand(post.brand_id);
  const draft = await completeJson(`You are revising a social post for ${brand.name}. Voice: ${JSON.stringify(brand.voice || {})}.
Current copy per platform: ${JSON.stringify(post.copy)}. Image prompt: ${post.image_prompt}. Assets: ${JSON.stringify(post.assets)}.
Owner feedback: ${feedback || 'make it stronger'}.
Return JSON {copy:{<platform>:string}, image_prompt:string, alt_text:string, assets:{headline,sub,eyebrow,cta,layout,slides}} keeping the same platforms (${post.platforms.join(', ')}).`);
  const edited = editPost(id, { copy: draft.copy, image_prompt: draft.image_prompt, alt_text: draft.alt_text, assets: draft.assets, platforms: post.platforms, scheduled_at: post.scheduled_at }, post.version);
  requeueVisual(id, { fresh: body.fresh_image !== false });
  return edited;
}

function serveAsset(url, res) {
  const raw = url.searchParams.get('path') || '';
  const candidate = resolve(raw);
  if (!existsSync(candidate)) throw new WorkflowError('Asset not found',404);
  const abs = realpathSync(candidate);
  if (![ASSETS_DIR, BRANDS_DIR].some((root) => abs.startsWith(realpathSync(root) + '/')) || !statSync(abs).isFile()) throw new WorkflowError('Asset not found', 404);
  res.writeHead(200, { 'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=60' });
  createReadStream(abs).on('error', () => res.destroy()).pipe(res); return true;
}

/** Unauthenticated: the browser lands here after the provider redirect. */
export async function oauthCallback(url, res) {
  let msg;
  try { const a = await finish(Object.fromEntries(url.searchParams)); msg = `Connected ${PLATFORMS[a.platform].name} as ${a.label}. You can close this tab.`; }
  catch (e) { msg = `Connection failed: ${e.message}`; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset=utf-8><title>Cadence</title><body style="font:16px -apple-system,system-ui;padding:3rem;color:#111"><h1 style="font-size:1.4rem">Cadence</h1><p>${msg.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>`);
  return true;
}

/** Returns true when the request was handled. */
export async function extraRoutes({ req, res, url, path, body, actor, owner, send }) {
  const m = (re) => path.match(re);
  let x;
  if (path === '/api/brands' && req.method === 'POST') { const r = createBrandFromUrl(body); send(r.status, r.brand); return true; }
  if ((x = m(/^\/api\/brands\/([^/]+)$/)) && req.method === 'GET') { const b = getBrand(x[1]); if (!b) throw new WorkflowError('Brand not found', 404); send(200, b); return true; }
  if ((x = m(/^\/api\/brands\/([^/]+)\/extract$/)) && req.method === 'POST') { owner(); if (!getBrand(x[1])) throw new WorkflowError('Brand not found', 404); send(202, { job: enqueue('brand-extract', x[1]) }); return true; }
  if ((x = m(/^\/api\/brands\/([^/]+)\/design-loop$/)) && req.method === 'POST') { owner(); if (!getBrand(x[1])) throw new WorkflowError('Brand not found', 404); send(202, { job: enqueue('design-loop', x[1]) }); return true; }
  if ((x = m(/^\/api\/campaigns\/([^/]+)$/)) && req.method === 'GET') {
    const c = hydrate(one('SELECT * FROM campaigns WHERE id = ?', x[1])); if (!c) throw new WorkflowError('Campaign not found', 404);
    send(200, { ...c, posts: all('SELECT * FROM posts WHERE campaign_id = ? ORDER BY scheduled_at', x[1]).map(hydrate) }); return true;
  }
  if ((x = m(/^\/oauth\/([a-z]+)\/start$/)) && req.method === 'GET') {
    owner(); const brandId = url.searchParams.get('brand_id'); if (!getBrand(brandId)) throw new WorkflowError('Brand not found', 404);
    if (META[x[1]]?.auth !== 'oauth') throw new WorkflowError('Platform does not use OAuth');
    try {send(200, { url: startUrl(x[1], brandId) });} catch(error) {throw new WorkflowError(error.message,422);} return true;
  }
  if (path === '/api/accounts/manual' && req.method === 'POST') {
    owner(); if (META[body.platform]?.auth !== 'manual') throw new WorkflowError('Platform uses OAuth; open /oauth/<platform>/start');
    if (!getBrand(body.brand_id)) throw new WorkflowError('Brand not found', 404);
    for (const f of META[body.platform].fields || []) if (typeof body.fields?.[f] !== 'string' || !body.fields[f].trim()) throw new WorkflowError(`${f} is required`);
    try { send(201, await addManualAccount(body.brand_id, body.platform, body.fields)); } catch (e) { throw new WorkflowError(e.message, 422); }
    return true;
  }
  if ((x = m(/^\/api\/accounts\/([^/]+)$/))) {
    owner(); if (!one('SELECT id FROM accounts WHERE id = ?', x[1])) throw new WorkflowError('Account not found', 404);
    if (req.method === 'DELETE') { if(one('SELECT id FROM deliveries WHERE account_id=?',x[1]))throw new WorkflowError('This account has delivery history. Pause it to preserve publishing receipts.',409);run('DELETE FROM accounts WHERE id = ?', x[1]); send(200, { ok: true }); return true; }
    if (req.method === 'PATCH') { if (typeof body.trusted !== 'boolean') throw new WorkflowError('trusted must be true or false'); send(200, hydrate(update('accounts', x[1], { trusted: body.trusted ? 1 : 0 }))); return true; }
  }
  if (path === '/api/settings' && req.method === 'GET') { owner();send(200, Object.fromEntries(SETTINGS.map((k) => [k, getSetting(k, k === 'autonomy' ? 'review_all' : '')]))); return true; }
  if (path === '/api/settings' && req.method === 'PUT') {
    owner();
    for(const [k,v] of Object.entries(body)) {
      if (!SETTINGS.includes(k)) throw new WorkflowError(`Unknown setting ${k}`);
      if(k==='autonomy'&&!LEVELS.includes(v))throw new WorkflowError('Invalid autonomy level');
      if(k==='cap_per_account_per_day'&&v!==''&&(!/^\d+$/.test(String(v))||Number(v)<1||Number(v)>100))throw new WorkflowError('Daily cap must be 1–100 or empty');
      if(k==='design_loop_rounds'&&v!==''&&(!/^\d+$/.test(String(v))||Number(v)<1||Number(v)>6))throw new WorkflowError('Design rounds must be 1–6');
      if((k==='design_loop'||k==='auto_plan')&&!['','on','off'].includes(v))throw new WorkflowError(`${k==='auto_plan'?'Recurring planning':'Design loop'} must be on or off`);
      if(k==='timezone'&&v)try{new Intl.DateTimeFormat('en',{timeZone:v}).format();}catch{throw new WorkflowError('Unknown timezone');}
      if(k==='webhook_url'&&v)try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password)throw 0;}catch{throw new WorkflowError('webhook_url must be https');}
    }
    for (const [k, v] of Object.entries(body)) {
      if (!SETTINGS.includes(k)) throw new WorkflowError(`Unknown setting ${k}`);
      if (k === 'autonomy') setAutonomy(v); else if (k === 'webhook_url' && v) { try { const u = new URL(v); if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw 0; } catch { throw new WorkflowError('webhook_url must be https'); } setSetting(k, v); }
      else setSetting(k, String(v ?? ''));
    }
    send(200, { ok: true, autonomy: autonomy(), levels: LEVELS }); return true;
  }
  if ((x = m(/^\/api\/posts\/([^/]+)\/comments$/))) {
    postById(x[1]);
    if (req.method === 'GET') { send(200, all('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at', x[1])); return true; }
    if (req.method === 'POST') { if (typeof body.body !== 'string' || !body.body.trim()) throw new WorkflowError('Comment body is required'); const id = insert('comments', { post_id: x[1], author: actor, body: body.body.trim().slice(0, 4000) }); send(201, one('SELECT * FROM comments WHERE id = ?', id)); return true; }
  }
  if ((x = m(/^\/api\/posts\/([^/]+)\/approve-and-schedule$/)) && req.method === 'POST') { owner(); send(200, approveAndSchedule(x[1], body.version, actor, body.account_ids)); return true; }
  if ((x = m(/^\/api\/posts\/([^/]+)\/regenerate$/)) && req.method === 'POST') { owner(); send(202, await regenerate(x[1], body, actor)); return true; }
  if ((x = m(/^\/api\/posts\/([^/]+)\/rerender$/)) && req.method === 'POST') { owner(); postById(x[1]); send(202, { job: requeueVisual(x[1], { fresh: Boolean(body.fresh_image) }) }); return true; }
  if ((x = m(/^\/api\/posts\/([^/]+)\/publish-now$/)) && req.method === 'POST') {
    owner();
    transaction(() => {
      const post = postById(x[1]);
      if (!post.approved_by || !['approved','scheduled'].includes(post.status)) throw new WorkflowError('Approve the post before publishing',409);
      if (post.status === 'approved') {
        update('posts',post.id,{scheduled_at:new Date(Date.now()+60000).toISOString()});
        const accounts=all('SELECT id,platform FROM accounts WHERE brand_id=? AND paused=0',post.brand_id).filter(a=>post.platforms.includes(a.platform));
        schedulePost(post.id,post.version,accounts.map(a=>a.id));
      }
      update('posts',post.id,{scheduled_at:new Date().toISOString()});
    });
    send(200, postById(x[1])); return true;
  }
  if (path === '/api/media' && req.method === 'GET') { const b = url.searchParams.get('brand_id'); if (!b) throw new WorkflowError('brand_id is required'); send(200, listMedia(b)); return true; }
  if (path === '/api/media' && req.method === 'POST') { owner(); send(201, importMedia(body.brand_id, body)); return true; }
  if ((x = m(/^\/api\/media\/([^/]+)$/)) && req.method === 'DELETE') { owner(); send(200, deleteMedia(x[1])); return true; }
  if ((x = m(/^\/api\/posts\/([^/]+)\/media$/))) {
    if (req.method === 'POST') { owner(); send(200, setPostMedia(x[1], body.media_id, body.version)); return true; }
    if (req.method === 'DELETE') { owner(); send(200, setPostMedia(x[1], null, body.version ?? postById(x[1]).version)); return true; }
  }
  if (path === '/api/assets' && req.method === 'GET') return serveAsset(url, res);
  if (path === '/api/analytics' && req.method === 'GET') { const b = url.searchParams.get('brand_id'); if (!b) throw new WorkflowError('brand_id is required'); send(200, analyticsFor(b)); return true; }
  if (path === '/api/rules' && req.method === 'GET') { send(200, loadRules()); return true; }
  if (path === '/api/rules' && req.method === 'PUT') { owner();try{send(200,saveRules(body));}catch(error){throw new WorkflowError(error.message);}return true; }
  return false;
}
