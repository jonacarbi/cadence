// Month calendar: each day is a measure, each post a note coloured by status.
import { h, clear, empty, errorBox, skeleton, head, btn, tone } from '../ui.js';
import { get } from '../api.js';
import { state } from '../state.js';
import { postCard } from '../postcard.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default async function render(main, ctx) {
  if (!state.brandId) return main.append(head('Calendar', 'Every post, by day.'), empty('No brand yet', 'Add a brand to see its schedule.', btn('Open setup', () => ctx.go('setup'), { cls: 'primary' })));
  let cursor = new Date(); cursor.setDate(1); let posts = [];
  const title = h('h2', { 'aria-live': 'polite' }), grid = h('div', { class: 'cal', role: 'grid' }), detail = h('div', { class: 'stack' });
  const draw = () => {
    title.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
    const first = (cursor.getDay() + 6) % 7, days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate(), today = key(new Date());
    const by = {}; for (const p of posts) (by[key(new Date(p.scheduled_at))] ||= []).push(p);
    clear(grid).append(...DAYS.map((d) => h('div', { class: 'dow', role: 'columnheader' }, d)), ...Array.from({ length: first }, () => h('div', { class: 'day blank', 'aria-hidden': 'true' })),
      ...Array.from({ length: days }, (_, i) => {
        const d = new Date(cursor.getFullYear(), cursor.getMonth(), i + 1), k = key(d), ps = by[k] || [];
        return h('div', { class: `day${k === today ? ' today' : ''}`, role: 'gridcell', 'aria-label': `${d.toDateString()}, ${ps.length} posts` }, h('span', { class: 'dn num' }, i + 1),
          ...ps.slice(0, 3).map((p) => h('button', { type: 'button', class: `note ${tone(p.status) || 'plain'}`, title: p.topic || p.status, onclick: () => show(p) }, h('span', { class: 'sr' }, `${p.status}: `), p.topic || p.platforms.join(', '))),
          ps.length > 3 && h('span', { class: 'more small muted' }, `+${ps.length - 3} more`));
      }));
  };
  const show = (p) => { clear(detail).append(postCard(p, { compact: true, onChange: (np) => { posts = posts.map((x) => (x.id === np.id ? np : x)); draw(); } })); detail.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }); };
  const step = (n) => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1); draw(); };
  main.append(head('Calendar', 'Every post by day. Filled dots have been approved; hollow ones still need you.'),
    h('div', { class: 'row' }, btn('Previous month', () => step(-1), { cls: 'icon-btn ghost', ico: 'chevL' }), title, btn('Next month', () => step(1), { cls: 'icon-btn ghost', ico: 'chevR' }), btn('Today', () => { cursor = new Date(); cursor.setDate(1); draw(); }, { cls: 'sm end' })),
    grid, detail);
  clear(grid).append(skeleton(3, 'card'));
  try { posts = await get(`/api/posts?brand_id=${state.brandId}`); draw(); if (!posts.length) detail.append(empty('Nothing planned yet', 'Ask the content agent for a month of posts and they will fill this calendar.', btn('Create content', () => ctx.go('create'), { cls: 'primary' }))); } catch (e) { clear(grid).append(errorBox(e, () => ctx.reload())); }
}
