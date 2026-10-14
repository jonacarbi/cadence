// One platform's connection card, shared by the setup wizard and the Accounts page.
// Manual platforms: an inline form. OAuth platforms: numbered guide, copyable redirect URI, app credentials, then sign-in.
import { h, btn, busy, field, badge, icon, copy, toast, notice } from './ui.js';
import { get, send } from './api.js';
import { state } from './state.js';

const POLL_MS = 3000, POLL_MAX = 100; // ~5 minutes

function inputFor(f, cur = '') {
  return h('input', { type: f.secret ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false', placeholder: f.placeholder || '', value: cur, 'data-key': f.key });
}
const collect = (box) => Object.fromEntries([...box.querySelectorAll('[data-key]')].map((i) => [i.dataset.key, i.value.trim()]));

function steps(list) { return list?.length ? h('ol', { class: 'steps' }, list.map((s) => h('li', null, s.replace(/^\d+\.\s*/, '')))) : null; }

function manualForm(p, brandId, done) {
  const form = h('div', { class: 'stack' });
  const label = h('input', { type: 'text', placeholder: `${p.name} account name`, autocomplete: 'off', 'data-label': '1' });
  form.append(field('Account name', label, 'Only shown inside Cadence, so you can tell accounts apart.'));
  for (const f of p.account_fields || []) form.append(field(f.title, inputFor(f), f.help));
  const go = btn('Connect account', () => busy(go, async () => {
    if (!brandId) throw new Error('Choose or create a brand first.');
    const fields = collect(form); if (label.value.trim()) fields.label = label.value.trim();
    await send('POST', '/api/accounts/manual', { brand_id: brandId, platform: p.id, fields });
    toast(`${p.name} connected`); done();
  }), { cls: 'primary' });
  form.append(h('div', { class: 'row' }, go));
  return form;
}

function appForm(p, saved) {
  const box = h('div', { class: 'stack' });
  const fields = p.app_fields?.length ? p.app_fields : [{ key: 'client_id', title: 'Client ID' }, { key: 'client_secret', title: 'Client secret', secret: true }];
  for (const f of fields) box.append(field(f.title, inputFor({ ...f, key: /secret/i.test(f.key + f.title) ? 'client_secret' : 'client_id' })));
  const save = btn('Save app credentials', () => busy(save, async () => {
    const v = collect(box); if (!v.client_id || !v.client_secret) throw new Error('Paste both the client ID and the client secret.');
    const row = await send('PUT', `/api/platforms/${p.id}/app`, v); toast(`${p.name} app saved`); saved(row);
  }), { cls: 'ink' });
  box.append(h('div', { class: 'row' }, save, h('span', { class: 'small muted' }, 'Saved encrypted on this machine, readable only by your user. Never shown again.')));
  return box;
}

async function signIn(p, brandId, button, done) {
  if (!brandId) throw new Error('Choose or create a brand first.');
  const { url, state } = await get(`/oauth/${p.id}/start?brand_id=${encodeURIComponent(brandId)}`);
  if (!/^https:\/\//.test(url)) throw new Error('The sign-in address looks wrong. Check the app credentials.');
  window.open(url, '_blank', 'noopener,noreferrer');
  button.textContent = 'Waiting for you to approve in the new tab...';
  // Poll this attempt, not the account count: a reconnect updates the existing row and adds none.
  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (!button.isConnected) return;
    const a = await get(`/oauth/status?state=${encodeURIComponent(state)}`);
    if (a.status === 'done') { toast(`${p.name} connected as ${a.account.label}`); return done(); }
    if (a.status === 'error') throw new Error(a.error);
  }
  throw new Error('Still waiting. If you approved it, reload this page to see the account.');
}

function oauthBody(p, brandId, done, saved) {
  const parts = [steps(p.steps)];
  parts.push(h('div', { class: 'redirect' }, h('span', { class: 'label' }, 'Redirect URI to paste into the developer portal'),
    h('div', { class: 'row' }, h('code', { class: 'grow' }, p.redirect_uri || '(set by the server)'), btn('Copy', () => copy(p.redirect_uri, 'Redirect URI copied'), { cls: 'sm', ico: 'copy', 'aria-label': `Copy ${p.name} redirect URI` }))));
  if (p.tls && !p.tls.ready) parts.push(notice('warn', `${p.name} needs an https callback, and the local certificate could not be made${p.tls.openssl ? '' : ' because openssl was not found. Install openssl and restart Cadence'}.`));
  if (p.callback_note) parts.push(h('p', { class: 'small muted' }, p.callback_note));
  if (p.developer_portal_url) parts.push(h('a', { class: 'btn sm', href: p.developer_portal_url, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), `Open ${p.name} developer portal`));
  if (p.scopes?.length) parts.push(h('p', { class: 'small muted' }, 'Permissions requested: ', p.scopes.join(', ')));
  parts.push(h('details', { class: 'app-creds', open: !p.ready }, h('summary', null, p.ready ? 'Replace app credentials' : 'Paste your app credentials'), appForm(p, saved)));
  const go = btn(`Sign in with ${p.name}`, () => busy(go, () => signIn(p, brandId, go, done)), { cls: 'primary', disabled: !p.ready });
  parts.push(h('div', { class: 'row' }, go, !p.ready && h('span', { class: 'small muted' }, 'Save the app credentials first.')));
  return parts;
}

export function platformCard(p, brandId, done) {
  // Saving app credentials flips this card to ready in place, using the row the server returns.
  const saved = (row) => { if (!row?.id) return; const next = platformCard(row, brandId, done); next.open = true; card.replaceWith(next); };
  const body = p.auth === 'manual' ? [steps(p.steps), manualForm(p, brandId, done)] : oauthBody(p, brandId, done, saved);
  const lim = p.limits ? `Safe default: ${p.limits.daily_cap_default} posts a day, ${p.limits.min_gap_minutes_default} min apart.` : '';
  const card = h('details', { class: 'card platform', id: `pf-${p.id}` },
    h('summary', null, h('span', { class: 'p-name' }, p.name), state.accounts.some((a) => a.brand_id === brandId && a.platform === p.id) ? badge('Connected', 'ok') : badge(p.auth === 'oauth' ? 'Sign in' : 'Keys', ''), p.auth === 'oauth' && badge(p.ready ? 'Keys saved' : 'Needs app', p.ready ? '' : 'warn')),
    h('div', { class: 'stack platform-body' }, lim && h('p', { class: 'small muted' }, lim), p.needs_public_media && h('p', { class: 'small muted' }, 'Needs public image hosting (Supabase) to publish images.'), body));
  return card;
}
