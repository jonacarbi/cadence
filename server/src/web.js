// Browser access: static UI (server/web), cookie sessions, and the checks that make cookies safe.
// Sessions are random ids in memory (not HMAC-derived): logout really revokes, nothing to forge offline,
// and a restart simply asks the user to run `npm run open` again. Cost: one re-login per restart.
// The browser never sees the owner token: `cadence open` trades it (Bearer, POST /auth/ticket) for a single-use
// 60-second ticket, so the URL that lands in argv, `ps` and browser history is worthless once used.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerToken } from './auth.js';

export const WEB_ROOT = realpathSync(fileURLToPath(new URL('../web', import.meta.url)));
export const SESSION_COOKIE = 'cadence_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000, MAX_SESSIONS = 20;
const sessions = new Map(); // id -> expiry (ms)
const tickets = new Map(); // single-use login ticket -> expiry (ms)
const TICKET_TTL_MS = 60_000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
export const UI_CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const cookieOf = (req) => (req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s)).find(([k]) => k === SESSION_COOKIE)?.[1] || '';

export function createSession() {
  const now = Date.now();
  for (const [id, exp] of sessions) if (exp < now) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  const id = randomBytes(32).toString('hex'); sessions.set(id, now + SESSION_TTL_MS); return id;
}
export const dropSession = (req) => sessions.delete(cookieOf(req));
const hasSession = (req) => { const id = cookieOf(req), exp = sessions.get(id); if (!exp) return false; if (exp < Date.now()) { sessions.delete(id); return false; } return true; };

/** The one origin this request may legitimately come from: same scheme, same loopback host:port it was sent to. */
export const ownOrigin = (req) => `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;

/** Cookie auth => 'owner'. Refuses unless Origin (when sent) is our own and, for writes, the CSRF header is present.
 *  The Host pin runs earlier in api.js, so ownOrigin() is always a loopback name on our port. */
export function cookieActor(req) {
  if (!hasSession(req)) return null;
  if (req.headers.origin && req.headers.origin !== ownOrigin(req)) return null;
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-cadence-csrf'] !== '1') return null;
  return 'owner';
}
/** Host must be loopback AND carry our actual listening port; Origin, if present, must be ourselves. */
export function hostAndOriginOk(req) {
  const m = /^(127\.0\.0\.1|localhost)(?::(\d+))?$/.exec(req.headers.host || '');
  if (!m) return false;
  if (m[2] && Number(m[2]) !== req.socket.localPort) return false;
  return !req.headers.origin || req.headers.origin === ownOrigin(req);
}

function text(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(body); return true; }

/** POST /auth/ticket (Bearer owner), GET /auth/login?c=TICKET, POST /auth/logout, GET /auth/session. Returns true when handled. */
export function authRoutes(req, res, url) {
  const path = url.pathname;
  if (path === '/auth/ticket' && req.method === 'POST') {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || '';
    if (!bearer || !same(bearer, ownerToken)) return text(res, 401, 'Owner token required');
    const now = Date.now();
    for (const [k, exp] of tickets) if (exp < now) tickets.delete(k);
    const ticket = randomBytes(32).toString('hex'); tickets.set(ticket, now + TICKET_TTL_MS);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ticket, expires_in: TICKET_TTL_MS / 1000 })); return true;
  }
  if (path === '/auth/login' && req.method === 'GET') {
    const c = url.searchParams.get('c') || '', exp = tickets.get(c);
    tickets.delete(c); // single use, even when expired
    if (!c || !exp || exp < Date.now()) return text(res, 401, 'This sign-in link is invalid or already used. Run `npm run open` (or choose Open Web Dashboard in the Mac app) for a fresh one.');
    const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_TTL_MS / 1000}`];
    if (req.socket.encrypted) flags.push('Secure');
    // Location carries no ticket: it must not reach history, logs or Referer.
    res.writeHead(302, { 'Set-Cookie': `${SESSION_COOKIE}=${createSession()}; ${flags.join('; ')}`, Location: '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(); return true;
  }
  // POST (CSRF header required) so another localhost page cannot sign the owner out with a link.
  if (path === '/auth/logout' && req.method === 'POST') {
    if (req.headers['x-cadence-csrf'] !== '1') return text(res, 401, 'Missing CSRF header');
    dropSession(req);
    res.writeHead(204, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`, 'Cache-Control': 'no-store' });
    res.end(); return true;
  }
  if (path === '/auth/session' && req.method === 'GET') {
    res.writeHead(hasSession(req) ? 200 : 401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ signed_in: hasSession(req) })); return true;
  }
  return false;
}

/** GET-only static files from server/web. Realpath containment defeats ../, encoded dots and symlinks. */
export function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return text(res, 400, 'Bad path'); }
  if (rel === '/') rel = '/index.html';
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').some((s) => s.startsWith('.'))) return text(res, 404, 'Not found');
  let abs;
  try { abs = realpathSync(join(WEB_ROOT, rel)); } catch { return text(res, 404, 'Not found'); }
  const st = statSync(abs, { throwIfNoEntry: false });
  const type = MIME[extname(abs).toLowerCase()];
  if (!abs.startsWith(WEB_ROOT + sep) || !st?.isFile() || !type) return text(res, 404, 'Not found');
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const isFont = type === 'font/woff2', isIndex = abs.endsWith(`${sep}index.html`);
  const headers = {
    'Content-Type': type, ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': UI_CSP,
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Cache-Control': isIndex ? 'no-store' : isFont ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (!isIndex && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  headers['Content-Length'] = st.size; res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(abs).on('error', () => res.destroy()).pipe(res); return true;
}
