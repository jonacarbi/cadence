// Tiny DOM toolkit. Everything dynamic goes through textContent: server data is never parsed as HTML.
const SVG = 'http://www.w3.org/2000/svg';
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'open', 'readOnly', 'required']);
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'style') continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  add(e, kids); return e;
}
function add(e, kids) { for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); }
export const clear = (e) => { e.replaceChildren(); return e; };

// Lucide-style 24px stroke paths (ISC). Inline because the CSP allows no external icon fonts.
const ICONS = {
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  palette: 'M12 22a10 10 0 1 1 10-10c0 3-2 4-4 4h-2a2 2 0 0 0-1 3.7c.6.4.5 2.3-3 2.3zM7.5 12.5h.01M10 7.5h.01M15 7.5h.01',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  check: 'M20 6L9 17l-5-5', x: 'M18 6L6 18M6 6l12 12', plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1', link: 'M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  chevL: 'M15 18l-6-6 6-6', chevR: 'M9 18l6-6-6-6', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};
export function icon(name) {
  const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', ICONS[name] || ''); s.append(p); return s;
}

export const btn = (label, onclick, { cls = '', ico, title, ...rest } = {}) =>
  h('button', { type: 'button', class: `btn ${cls}`, onclick, title, 'aria-label': cls.includes('icon-btn') ? label : null, ...rest }, ico && icon(ico), cls.includes('icon-btn') ? null : label);

/** Run an async action behind a button: busy state, no double submits, errors land in the toast. */
export async function busy(button, fn) {
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true'); button.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, 'error'); } finally { button.removeAttribute('aria-busy'); button.disabled = false; }
}
let uid = 0;
export function field(label, input, help) {
  const id = input.id || (input.id = `f${++uid}`);
  const helpId = help ? `${id}-h` : null; if (helpId) input.setAttribute('aria-describedby', helpId);
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, help && h('p', { class: 'help', id: helpId }, help));
}
export const badge = (text, tone = '') => h('span', { class: `badge ${tone}` }, text);
export const skeleton = (n = 3, cls = 'card') => h('div', { class: 'grid', 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: n }, () => h('div', { class: `skel ${cls}` })));
export const empty = (title, body, ...actions) => h('div', { class: 'empty' }, h('h3', null, title), body && h('p', null, body), actions.length > 0 && h('div', { class: 'row' }, actions));
export const errorBox = (err, retry) => h('div', { class: 'notice error', role: 'alert' }, h('div', { class: 'grow' }, h('strong', null, 'Something went wrong. '), err.message || String(err)), retry && btn('Try again', retry, { cls: 'sm' }));
export const notice = (tone, ...kids) => h('div', { class: `notice ${tone}`, role: tone === 'error' ? 'alert' : null }, h('div', { class: 'grow' }, kids));

export function toast(message, kind = '') {
  const box = document.getElementById('toasts'); if (!box) return;
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message); box.append(t);
  setTimeout(() => t.remove(), kind ? 8000 : 3500);
}
export async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('Copy failed. Select the text and copy it by hand.', 'error'); }
}
export const when = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => iso ? new Intl.DateTimeFormat(undefined, opts).format(new Date(iso.length === 19 && !iso.includes('T') ? iso.replace(' ', 'T') + 'Z' : iso)) : '';
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const assetUrl = (p) => `/api/assets?path=${encodeURIComponent(p)}`;
export const head = (title, lede) => h('header', { class: 'page-head' }, h('h1', null, title), lede && h('p', null, lede), h('span', { class: 'dot', 'aria-hidden': 'true' }));
export const tone = (status) => ({ published: 'ok', approved: 'ok', scheduled: 'ok', complete: 'ok', connected: 'ok', ready: 'ok', draft: 'warn', review: 'warn', running: 'warn', queued: 'warn', uncertain: 'warn', needs_accounts: 'warn', rejected: 'beat', failed: 'beat', needs_reconnect: 'beat', interrupted: 'beat' }[status] || '');

/** Scheduling can succeed with warnings (for example near-duplicate text). Show them instead of burying them. */
export function scheduled(res, ok = 'Scheduled') {
  const w = [...new Set([res?.warnings, ...(res?.posts || []).map((p) => p.warnings)].flat().filter(Boolean))];
  toast(w.length ? `${ok}. Heads up: ${w.join(' ')}` : ok, w.length ? 'warn' : '');
}
