// Activity: what Cadence did and what happened to each delivery. Read-only, newest first.
import { h, clear, badge, empty, errorBox, skeleton, head, when, tone } from '../ui.js';
import { get } from '../api.js';

const LEVEL = { error: 'beat', warn: 'warn', info: '' };

export default async function render(main) {
  const body = h('div', { class: 'stack' }); main.append(head('Activity', 'A plain record of everything Cadence has done on your behalf.'), body, h('h2', null, 'Deliveries'));
  const dl = h('div', { class: 'stack' }); main.append(dl);
  clear(body).append(skeleton(3, 'skel'));
  try {
    const [events, deliveries] = await Promise.all([get('/api/events'), get('/api/deliveries')]);
    clear(body).append(...(events.length ? [h('ol', { class: 'log' }, events.map((e) => h('li', { class: `lv-${e.level}` }, h('time', { class: 'small muted num', datetime: e.ts }, when(e.ts)), badge(e.kind, LEVEL[e.level] ?? ''), h('span', null, e.message))))] : [empty('Quiet so far', 'Events appear here as Cadence plans, approves and publishes.')]));
    clear(dl).append(...(deliveries.length ? [h('div', { class: 'tablewrap' }, h('table', null, h('thead', null, h('tr', null, ['When', 'Status', 'Attempts', 'Result'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', null, deliveries.slice(0, 100).map((d) => h('tr', null, h('td', { class: 'num' }, when(d.finished_at || d.started_at || d.next_attempt_at)), h('td', null, badge(d.status, tone(d.status === 'published' || d.status === 'done' ? 'published' : d.status))), h('td', { class: 'num' }, d.attempts), h('td', null, /^https?:\/\//i.test(d.remote_url || '') ? h('a', { href: d.remote_url, target: '_blank', rel: 'noopener noreferrer' }, 'View post') : d.error || ''))))))] : [empty('No deliveries yet', 'Once a scheduled post goes out, its receipt shows here.')]));
  } catch (e) { clear(body).append(errorBox(e, () => location.reload())); }
}
