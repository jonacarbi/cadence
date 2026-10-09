// Approval inbox: drafts first, then what is scheduled, then what is done. Every post is editable in place.
import { h, clear, empty, errorBox, skeleton, head, btn } from '../ui.js';
import { get } from '../api.js';
import { state } from '../state.js';
import { postCard } from '../postcard.js';

const TABS = [['review', 'To review', (p) => ['draft', 'rejected', 'missed'].includes(p.status)], ['scheduled', 'Scheduled', (p) => ['approved', 'scheduled', 'publishing'].includes(p.status)], ['done', 'Done', (p) => ['published', 'failed', 'uncertain'].includes(p.status)]];

export default async function render(main, ctx) {
  if (!state.brandId) return main.append(head('Inbox', 'Posts wait here for your yes.'), empty('No brand yet', 'Add a brand first. Cadence drafts posts for it and they show up here for approval.', btn('Open setup', () => ctx.go('setup'), { cls: 'primary' })));
  let tab = 'review', posts = [];
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Post status' }), list = h('div', { class: 'stack posts', role: 'tabpanel' });
  const draw = () => {
    clear(tabs).append(...TABS.map(([k, l, f]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), 'aria-pressed': String(k === tab), onclick: () => { tab = k; draw(); } }, `${l} `, h('span', { class: 'num muted' }, posts.filter(f).length))));
    const mine = posts.filter(TABS.find((t) => t[0] === tab)[2]).sort((a, b) => (tab === 'done' ? b.scheduled_at.localeCompare(a.scheduled_at) : a.scheduled_at.localeCompare(b.scheduled_at)));
    clear(list).append(...(mine.length ? mine.map((p) => postCard(p, { onChange: (np) => { posts = posts.map((x) => (x.id === np.id ? np : x)); setTimeout(draw, 600); } })) : [empty(tab === 'review' ? 'Nothing waiting on you' : tab === 'scheduled' ? 'Nothing scheduled' : 'Nothing published yet', tab === 'review' ? 'Ask the content agent for a post or a month of them and the drafts land here.' : null, tab === 'review' && btn('Create content', () => ctx.go('create'), { cls: 'primary' }))]));
  };
  const load = async () => {
    clear(list).append(skeleton(2, 'card'));
    try { posts = await get(`/api/posts?brand_id=${state.brandId}`); const n = posts.filter((p) => p.status === 'draft').length; document.getElementById('inbox-count')?.replaceChildren(n ? String(n) : ''); if (!posts.some(TABS[0][2]) && posts.some(TABS[1][2])) tab = 'scheduled'; draw(); } catch (e) { clear(list).append(errorBox(e, load)); }
  };
  main.append(head('Inbox', 'Read, tweak, approve. Nothing goes out until you say so, unless you chose otherwise in Settings.'), tabs, list);
  await load();
}
