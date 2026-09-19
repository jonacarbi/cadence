// Second route table: brands-from-URL, OAuth, accounts, settings, comments, regenerate, assets, analytics, rules.
import { randomUUID } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { mkdirSync, existsSync, createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { all, one, insert, update, hydrate, run, getSetting, setSetting } from './db.js';
import { BRANDS_DIR, ASSETS_DIR, REPO_DIR } from './config.js';
import { WorkflowError, postById, approvePost, schedulePost, editPost } from './workflow.js';
import { PLATFORMS } from './providers/index.js';
import { META } from './providers/registry.js';
import { startUrl, finish, addManualAccount } from './oauth.js';
import { enqueue } from './jobs.js';
import { requeueVisual } from './visuals.js';
import { LEVELS, setAutonomy, autonomy } from './autonomy.js';
import { analyticsFor } from './analytics.js';
import { completeJson } from './llm.js';
import { getBrand, slugify } from './brands.js';

const RULES_PATH = join(REPO_DIR, 'server/rules.json');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.md': 'text/markdown', '.json': 'application/json' };
const SETTINGS = ['autonomy', 'cap_per_account_per_day', 'webhook_url', 'webhook_secret', 'timezone', 'design_loop', 'design_loop_rounds'];

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
  const approved = approvePost(id, version, actor);
  const ids = Array.isArray(accountIds) && accountIds.length ? accountIds
    : approved.platforms.flatMap((p) => all('SELECT id FROM accounts WHERE brand_id = ? AND platform = ? AND paused = 0', approved.brand_id, p).map((a) => a.id));
  if (!ids.length) return approved; // approved, not scheduled: no accounts yet
  return schedulePost(id, approved.version, ids);
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
  const abs = resolve(raw);
  if (![ASSETS_DIR, BRANDS_DIR].some((root) => abs.startsWith(resolve(root) + '/')) || !existsSync(abs)) throw new WorkflowError('Asset not found', 404);
  res.writeHead(200, { 'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'private, max-age=60' });
  createReadStream(abs).pipe(res); return true;
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
  if (path === '/api/brands' && req.method === 'POST' && !body.name) { const r = createBrandFromUrl(body); send(r.status, r.brand); return true; }
  if ((x = m(/^\/api\/brands\/([^/]+)$/)) && req.method === 'GET') { const b = getBrand(x[1]); if (!b) throw new WorkflowError('Brand not found', 404); send(200, b); return true; }
  if ((x = m(/^\/api\/brands\/([^/]+)\/extract$/)) && req.method === 'POST') { owner(); if (!getBrand(x[1])) throw new WorkflowError('Brand not found', 404); send(202, { job: enqueue('brand-extract', x[1]) }); return true; }
  if ((x = m(/^\/api\/campaigns\/([^/]+)$/)) && req.method === 'GET') {
    const c = hydrate(one('SELECT * FROM campaigns WHERE id = ?', x[1])); if (!c) throw new WorkflowError('Campaign not found', 404);
    send(200, { ...c, posts: all('SELECT * FROM posts WHERE campaign_id = ? ORDER BY scheduled_at', x[1]).map(hydrate) }); return true;
  }
  if ((x = m(/^\/oauth\/([a-z]+)\/start$/)) && req.method === 'GET') {
    owner(); const brandId = url.searchParams.get('brand_id'); if (!getBrand(brandId)) throw new WorkflowError('Brand not found', 404);
    if (META[x[1]]?.auth !== 'oauth') throw new WorkflowError('Platform does not use OAuth');
    send(200, { url: startUrl(x[1], brandId) }); return true;
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
    if (req.method === 'DELETE') { run('DELETE FROM accounts WHERE id = ?', x[1]); send(200, { ok: true }); return true; }
    if (req.method === 'PATCH') { if (typeof body.trusted !== 'boolean') throw new WorkflowError('trusted must be true or false'); send(200, hydrate(update('accounts', x[1], { trusted: body.trusted ? 1 : 0 }))); return true; }
  }
  if (path === '/api/settings' && req.method === 'GET') { send(200, Object.fromEntries(SETTINGS.map((k) => [k, getSetting(k, k === 'autonomy' ? 'review_all' : '')]))); return true; }
  if (path === '/api/settings' && req.method === 'PUT') {
    owner();
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
    owner(); const post = postById(x[1]); if (!post.approved_by) throw new WorkflowError('Approve the post first');
    update('posts', x[1], { scheduled_at: new Date().toISOString() }); run("UPDATE deliveries SET scheduled_at = ? WHERE post_id = ? AND status = 'scheduled'", new Date().toISOString(), x[1]);
    send(200, postById(x[1])); return true;
  }
  if (path === '/api/assets' && req.method === 'GET') return serveAsset(url, res);
  if (path === '/api/analytics' && req.method === 'GET') { const b = url.searchParams.get('brand_id'); if (!b) throw new WorkflowError('brand_id is required'); send(200, analyticsFor(b)); return true; }
  if (path === '/api/rules' && req.method === 'GET') { send(200, JSON.parse(readFileSync(RULES_PATH, 'utf8'))); return true; }
  if (path === '/api/rules' && req.method === 'PUT') { owner(); if (!body || typeof body !== 'object') throw new WorkflowError('Rules must be a JSON object'); writeFileSync(RULES_PATH, JSON.stringify(body, null, 2)); send(200, body); return true; }
  return false;
}
