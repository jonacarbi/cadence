// Shell + hash router. Each view module default-exports render(root, ctx) and may return a cleanup function.
import { h, clear, icon, toast, btn } from './ui.js';
import { state, loadBrands, setBrand } from './state.js';
import { get } from './api.js';

const ROUTES = [
  ['inbox', 'Inbox', 'inbox'], ['calendar', 'Calendar', 'calendar'], ['create', 'Content agent', 'spark'], ['accounts', 'Accounts', 'users'],
  ['brands', 'Brands', 'palette'], ['activity', 'Activity', 'pulse'], ['settings', 'Settings', 'gear'], ['setup', 'Setup', 'check'],
];
const root = document.getElementById('root');
let cleanup = null, token = 0;

function theme() { const d = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); return d; }
function toggleTheme(e) {
  const next = theme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cadence.theme', next); } catch { /* ignore */ }
  e.currentTarget.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon'));
}

function signedOut() {
  clear(root).append(h('main', { id: 'main', class: 'gate' },
    h('img', { src: '/mark.svg', width: 56, height: 56, alt: '' }),
    h('h1', null, 'Open Cadence from ', h('em', null, 'your own machine')),
    h('p', null, 'This dashboard only opens through a private sign-in link, so nothing else on your network or in your browser can reach it.'),
    h('ol', { class: 'gate-steps' }, h('li', null, 'Run ', h('code', null, 'npm run open'), ' in the Cadence folder, or choose Open Web Dashboard in the Mac app.'),
      h('li', null, 'Your browser lands back here, signed in for 7 days.')),
    btn('Check again', () => location.reload(), { cls: 'ink' })));
}

function shell() {
  const brandSel = h('select', { id: 'brand-pick', 'aria-label': 'Active brand', onchange: (e) => setBrand(e.target.value || null) });
  const themeBtn = h('button', { type: 'button', class: 'btn ghost icon-btn', 'aria-label': 'Toggle light and dark theme', onclick: toggleTheme }, icon(theme() === 'dark' ? 'sun' : 'moon'));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, ROUTES.map(([id, label, ico]) => h('a', { href: `#/${id}`, 'data-route': id }, icon(ico), label, id === 'inbox' && h('span', { class: 'count', id: 'inbox-count', hidden: true }))));
  nav.addEventListener('focusin', (e) => e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })); // the mobile strip scrolls sideways
  clear(root).append(h('div', { class: 'app' },
    h('aside', { class: 'rail' }, h('a', { class: 'logo', href: '#/inbox' }, h('img', { src: '/mark.svg', alt: '' }), 'Cadence'),
      h('div', { class: 'field' }, h('label', { class: 'sr', for: 'brand-pick' }, 'Active brand'), brandSel), nav,
      h('div', { class: 'rail-foot' }, themeBtn, btn('Sign out', () => fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Cadence-CSRF': '1' } }).finally(() => location.reload()), { cls: 'ghost sm', ico: 'out' }))),
    h('main', { id: 'main', class: 'main', tabindex: '-1' })));
  fillBrands();
}
function fillBrands() {
  const sel = document.getElementById('brand-pick'); if (!sel) return;
  sel.replaceChildren(...(state.brands.length ? state.brands.map((b) => h('option', { value: b.id, selected: b.id === state.brandId }, b.name)) : [h('option', { value: '' }, 'No brands yet')]));
}

async function route() {
  const id = (location.hash.match(/^#\/([a-z-]+)/) || [])[1] || 'inbox';
  const spec = ROUTES.find((r) => r[0] === id) || ROUTES[0];
  const main = document.getElementById('main'); if (!main) return;
  const mine = ++token; if (cleanup) { try { cleanup(); } catch { /* view cleanup must not block navigation */ } cleanup = null; }
  document.querySelectorAll('.nav a').forEach((a) => (a.dataset.route === spec[0] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `${spec[1]} · Cadence`;
  clear(main);
  try {
    const mod = await import(`./views/${spec[0]}.js`);
    if (mine !== token) return;
    const out = await mod.default(main, { state, reload: route, go: (r) => { location.hash = `#/${r}`; } });
    if (mine === token && typeof out === 'function') cleanup = out; else if (mine !== token && typeof out === 'function') out();
    if (mine === token) main.focus({ preventScroll: true });
  } catch (e) { if (mine === token) main.append(h('div', { class: 'notice error', role: 'alert' }, e.message)); }
}

async function boot() {
  const s = await fetch('/auth/session', { credentials: 'same-origin' }).catch(() => null);
  if (!s || s.status === 401) return signedOut();
  window.addEventListener('cadence:signed-out', signedOut);
  window.addEventListener('cadence:brand', () => route());
  try { await loadBrands(); } catch (e) { toast(e.message, 'error'); }
  shell();
  if (!location.hash) { let done = false; try { done = localStorage.getItem('cadence.setup') === 'done'; } catch { /* ignore */ } location.hash = state.brands.length || done ? '#/inbox' : '#/setup'; }
  window.addEventListener('hashchange', route);
  window.addEventListener('cadence:brands', async () => { await loadBrands(); fillBrands(); });
  route();
  refreshCount(); setInterval(refreshCount, 30000);
}
async function refreshCount() {
  if (!state.brandId || document.hidden) return;
  try { const n = (await get(`/api/posts?brand_id=${state.brandId}`)).filter((p) => p.status === 'draft').length; const c = document.getElementById('inbox-count'); if (c) { c.textContent = n; c.hidden = !n; } } catch { /* badge is best-effort */ }
}
boot();
