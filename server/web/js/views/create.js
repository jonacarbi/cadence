// Content agent: describe what you want, watch it work, review, then schedule everything in one move.
import { h, clear, field, badge, empty, errorBox, skeleton, head, btn, busy, toast, scheduled, when, cap, tone } from '../ui.js';
import { get, send } from '../api.js';
import { state } from '../state.js';
import { postCard } from '../postcard.js';

const MODES = [['auto', 'Let the agent decide'], ['single', 'One post'], ['month', 'A month of posts'], ['brand', 'Brand identity only']];
const ACTIVE = ['queued', 'running'], POLL_MS = 4000;

function requestCard(r, ctx, refresh) {
  const prompt = r.input?.prompt || r.input?.website || 'Request';
  const nav = h('div', { class: 'row' });
  if (r.status === 'needs_accounts') nav.append(btn('Connect accounts', () => ctx.go('accounts'), { cls: 'sm primary' }), btn('Continue', async function go() { await send('POST', `/api/agent/requests/${r.id}/continue`, {}); refresh(); }, { cls: 'sm' }));
  if (['failed', 'interrupted'].includes(r.status)) nav.append(btn('Try again', async () => { await send('POST', `/api/agent/requests/${r.id}/continue`, {}); refresh(); }, { cls: 'sm' }));
  if (r.status === 'review' && r.posts.length) {
    const all = btn(`Approve and schedule all ${r.posts.length}`, () => busy(all, async () => { scheduled(await send('POST', `/api/agent/requests/${r.id}/schedule`, { versions: Object.fromEntries(r.posts.map((p) => [p.id, p.version])) }), 'Everything scheduled'); refresh(); }), { cls: 'primary', ico: 'check' });
    nav.append(all, btn('Review one by one', () => ctx.go('inbox'), { cls: 'sm ghost' }));
  }
  const posts = r.status === 'review' ? h('div', { class: 'stack' }, r.posts.slice(0, 3).map((p) => postCard(p, { compact: true })), r.posts.length > 3 && h('p', { class: 'small muted' }, `${r.posts.length - 3} more in the Inbox.`)) : null;
  return h('article', { class: 'card stack req' }, h('div', { class: 'row' }, badge(cap(r.status.replace('_', ' ')), tone(r.status)), h('span', { class: 'small muted end' }, when(r.created_at))),
    h('p', { class: 'req-prompt' }, prompt.length > 240 ? `${prompt.slice(0, 240)}...` : prompt),
    r.message && h('p', { class: 'small muted', 'aria-live': 'polite' }, ACTIVE.includes(r.status) && h('span', { class: 'pulse', 'aria-hidden': 'true' }), r.message), nav, posts);
}

export default async function render(main, ctx) {
  let timer, alive = true;
  const prompt = h('textarea', { rows: '4', placeholder: 'e.g. A month of posts for our spring menu launch, friendly and a bit cheeky. Or paste a website to learn the brand first.' });
  const site = h('input', { type: 'url', placeholder: 'https://optional-source-website.com' });
  let mode = 'auto'; const sel = h('select', { onchange: (e) => { mode = e.target.value; } }, MODES.map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div', { class: 'stack' }), go = btn('Start', () => busy(go, async () => {
    if (!prompt.value.trim() && !site.value.trim()) throw new Error('Describe what you want, or add a website.');
    await send('POST', '/api/agent/requests', { prompt: prompt.value.trim(), website: site.value.trim() || undefined, mode, brand_id: state.brandId || undefined });
    prompt.value = ''; toast('The agent is on it'); await load();
  }), { cls: 'primary', ico: 'spark' });
  async function load() {
    clearTimeout(timer);
    try {
      const rs = await get('/api/agent/requests'); if (!alive) return;
      clear(list).append(...(rs.length ? rs.map((r) => requestCard(r, ctx, load)) : [empty('No requests yet', 'Your first request will appear here with live progress.')]));
      if (rs.some((r) => ACTIVE.includes(r.status))) timer = setTimeout(load, POLL_MS);
    } catch (e) { clear(list).append(errorBox(e, load)); }
  }
  main.append(head('Content agent', 'Tell it what you need. It reads the brand, writes the posts, makes the visuals and lines them up for your approval.'),
    h('div', { class: 'card stack' }, field('What should it make?', prompt), h('div', { class: 'split' }, field('Source website (optional)', site), field('Scope', sel)), h('div', { class: 'row' }, go, !state.brandId && h('span', { class: 'small muted' }, 'No brand selected: the agent will create one from your description or website.'))),
    h('h2', null, 'Requests'), list);
  clear(list).append(skeleton(2)); await load();
  return () => { alive = false; clearTimeout(timer); };
}
