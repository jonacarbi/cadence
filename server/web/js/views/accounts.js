// Connected accounts per brand, with the health signals that matter: paused, needs reconnect, last error.
import { h, clear, badge, empty, errorBox, skeleton, head, btn, busy, toast, cap } from '../ui.js';
import { get, send, maybe } from '../api.js';
import { state, loadAccounts } from '../state.js';
import { platformCard } from '../connect.js';

export default async function render(main, ctx) {
  const list = h('div', { class: 'grid' }), add = h('div', { class: 'stack' });
  const draw = async () => {
    clear(list).append(skeleton(2));
    try {
      await loadAccounts(); const mine = state.accounts.filter((a) => a.brand_id === state.brandId);
      const row = (a) => {
        const pause = btn(a.paused ? 'Resume' : 'Pause', () => busy(pause, async () => { await send('POST', `/api/accounts/${a.id}/pause`, { paused: !a.paused }); toast(a.paused ? 'Resumed' : 'Paused'); draw(); }), { cls: 'sm' });
        const trust = btn(a.trusted ? 'Untrust' : 'Trust', () => busy(trust, async () => { await send('PATCH', `/api/accounts/${a.id}`, { trusted: !a.trusted }); draw(); }), { cls: 'sm ghost', title: 'Trusted accounts can auto-schedule when autonomy allows it' });
        return h('article', { class: 'card stack' }, h('div', { class: 'row' }, h('h3', null, a.label), h('span', { class: 'small muted' }, cap(a.platform))),
          h('div', { class: 'row' }, a.needs_reconnect ? badge('Needs reconnect', 'beat') : a.paused ? badge('Paused', 'warn') : badge('Connected', 'ok'), !!a.trusted && badge('Trusted')),
          a.last_error && h('p', { class: 'small err-text' }, a.last_error),
          h('div', { class: 'row' }, a.needs_reconnect && btn('Reconnect', (e) => busy(e.currentTarget, async () => { const { url } = await get(`/oauth/${a.platform}/start?brand_id=${encodeURIComponent(a.brand_id)}`); if (!/^https:\/\//.test(url)) throw new Error('Save the app credentials below first.'); window.open(url, '_blank', 'noopener,noreferrer'); toast('Approve in the new tab, then reload.'); }), { cls: 'sm primary' }), pause, trust));
      };
      clear(list).append(...(mine.length ? mine.map(row) : [empty('No accounts connected', 'Connect a platform below. Posts can only go out once a brand has an account to publish to.')]));
    } catch (e) { clear(list).append(errorBox(e, draw)); }
  };
  main.append(head('Accounts', 'Where this brand publishes. Pause an account any time and nothing goes out through it.'), list, h('h2', null, 'Connect a platform'), add);
  if (!state.brandId) { add.append(empty('Add a brand first', 'Accounts belong to a brand.', btn('Open setup', () => ctx.go('setup'), { cls: 'primary' }))); return; }
  await draw();
  const setup = await maybe('/api/platforms/setup').catch(() => null);
  if (!setup) return add.append(h('p', { class: 'muted' }, 'Guided platform setup is not available on this build.'));
  add.append(...setup.map((p) => platformCard(p, state.brandId, draw)));
}
