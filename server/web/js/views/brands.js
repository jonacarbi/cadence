// Brands and their design systems: the identity every post is drawn from.
import { h, clear, field, badge, empty, errorBox, skeleton, head, btn, busy, toast, tone, cap } from '../ui.js';
import { get, send, maybe } from '../api.js';
import { state, loadBrands, setBrand } from '../state.js';

const HEX = /^#[0-9a-f]{3,8}$/i;
const swatches = (t) => Object.entries(t?.colors || t || {}).filter(([, v]) => typeof v === 'string' && HEX.test(v)).slice(0, 6);

const dot = (c) => { const e = h('span', { class: 'sw', 'aria-hidden': 'true' }); e.style.background = c; return e; };

function brandCard(b, redraw) {
  const sw = swatches(b.tokens), pick = btn(b.id === state.brandId ? 'Selected' : 'Work on this brand', () => { setBrand(b.id); }, { cls: 'sm', disabled: b.id === state.brandId });
  const re = btn('Re-read website', () => busy(re, async () => { await send('POST', `/api/brands/${b.id}/extract`, {}); toast('Reading the site again'); redraw(); }), { cls: 'sm', ico: 'refresh' });
  const loop = btn('Refine design', () => busy(loop, async () => { await send('POST', `/api/brands/${b.id}/design-loop`, {}); toast('Design refinement started. It runs in the background.'); }), { cls: 'sm ghost', title: 'Three fresh critics iterate the tokens and layout' });
  return h('article', { class: `card stack${b.id === state.brandId ? ' current' : ''}` }, h('div', { class: 'row' }, h('h3', null, b.name), badge(cap(b.status), tone(b.status === 'ready' ? 'ready' : b.status === 'failed' ? 'failed' : 'running'))),
    b.url && h('a', { class: 'small', href: b.url, target: '_blank', rel: 'noopener noreferrer' }, b.url),
    sw.length > 0 && h('ul', { class: 'swatches', 'aria-label': 'Brand colours' }, sw.map(([k, v]) => h('li', null, dot(v), h('span', { class: 'small muted' }, k)))),
    b.voice?.tone && h('p', { class: 'small muted' }, `Voice: ${Array.isArray(b.voice.tone) ? b.voice.tone.join(', ') : b.voice.tone}`),
    h('div', { class: 'row' }, pick, re, loop));
}

async function systems(box, brandId) {
  clear(box).append(skeleton(1));
  try {
    const [mine, lib] = await Promise.all([get(`/api/brands/${brandId}/design-systems`), maybe('/api/design-library').catch(() => [])]);
    const reload = () => systems(box, brandId);
    const row = (s) => { const act = btn(s.active ? 'Active' : 'Use this', () => busy(act, async () => { await send('POST', `/api/brands/${brandId}/design-systems/${s.id}/activate`, {}); reload(); }), { cls: 'sm', disabled: Boolean(s.active) });
      const ref = btn('Refresh', () => busy(ref, async () => { await send('POST', `/api/brands/${brandId}/design-systems/${s.id}/refresh`, {}); toast('Refreshed from source'); reload(); }), { cls: 'sm ghost', ico: 'refresh' });
      return h('article', { class: 'card stack' }, h('div', { class: 'row' }, h('h3', null, s.name), s.active && badge('Active', 'ok')), h('p', { class: 'small muted' }, s.source_path), h('div', { class: 'row' }, act, ref)); };
    const known = new Set(mine.map((s) => s.source_path));
    const avail = (lib || []).filter((l) => !known.has(l.source_path));
    clear(box).append(...(mine.length ? [h('div', { class: 'grid' }, mine.map(row))] : [empty('No design system imported', 'Import one exported from Claude Design or a folder on this machine and posts will follow it exactly.')]),
      avail.length > 0 && h('div', { class: 'stack' }, h('h3', null, 'Found on this machine'), h('div', { class: 'grid' }, avail.map((l) => { const imp = btn('Import', () => busy(imp, async () => { await send('POST', `/api/brands/${brandId}/design-systems`, { source_id: l.id }); toast('Imported'); reload(); }), { cls: 'sm primary' });
        return h('article', { class: 'card stack' }, h('h3', null, l.name), h('p', { class: 'small muted' }, l.website || l.source_path), imp); }))));
  } catch (e) { clear(box).append(errorBox(e, () => systems(box, brandId))); }
}

export default async function render(main, ctx) {
  const list = h('div', { class: 'grid' }), sys = h('div', { class: 'stack' });
  const url = h('input', { type: 'url', placeholder: 'https://yourbusiness.com' }), name = h('input', { type: 'text', placeholder: 'Optional name' });
  const add = btn('Add brand', () => busy(add, async () => {
    if (!url.value.trim()) throw new Error('Enter the brand website.');
    const b = await send('POST', '/api/brands', { url: url.value.trim(), name: name.value.trim() || undefined }); url.value = name.value = '';
    await loadBrands(); setBrand(b.id); window.dispatchEvent(new Event('cadence:brands')); toast('Brand added. Cadence is reading the site.');
  }), { cls: 'primary', ico: 'plus' });
  const draw = async () => { await loadBrands(); clear(list).append(...(state.brands.length ? state.brands.map((b) => brandCard(b, draw)) : [empty('No brands yet', 'Add a website below and Cadence extracts colours, type and voice from it.')])); if (state.brandId) systems(sys, state.brandId); else clear(sys); };
  main.append(head('Brands', 'Each brand has its own colours, voice, accounts and schedule.'), list,
    h('div', { class: 'card stack' }, h('h3', null, 'Add a brand'), h('div', { class: 'split' }, field('Website', url), field('Name', name)), h('div', { class: 'row' }, add)),
    h('h2', null, 'Design systems'), sys);
  clear(list).append(skeleton(2)); await draw();
}
