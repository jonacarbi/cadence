// First-run wizard, re-openable any time at #/setup. Five measures: agent, images, brand, accounts, safety.
import { h, clear, btn, busy, field, badge, notice, errorBox, skeleton, toast, head } from '../ui.js';
import { send, maybe } from '../api.js';
import { state, loadBrands, setBrand, brand } from '../state.js';
import { platformCard } from '../connect.js';
import { safetyForm } from './safety.js';

const STEPS = ['AI agent', 'Images', 'First brand', 'Accounts', 'Safety'];
const TITLES = ['Choose your AI agent', 'Connect image generation', 'Add your first brand', 'Connect your accounts', 'Set the safety rails'];
const CONTEXT = { full: ['Full', 'Uses your agent’s own skills and memory. Best results; the agent can draw on what you have taught it.'], locked: ['Locked', 'Runs with a clean slate and no extra tools. Predictable, but it forgets your style.'] };

export async function agentStep(box) {
  const data = await maybe('/api/agent/providers');
  if (!data) return box.append(notice('warn', 'This Cadence build has no agent picker yet. It uses the default Claude CLI.'));
  let pick = data.active?.provider || data.providers.find((p) => p.detected)?.id || data.providers[0]?.id;
  let ctx = data.active?.context || 'full';
  const model = h('input', { type: 'text', list: 'models', autocomplete: 'off', value: data.active?.model || '' });
  const models = h('datalist', { id: 'models' });
  const extra = h('div', { class: 'stack' });
  const list = h('div', { class: 'grid choices', role: 'radiogroup', 'aria-label': 'AI agent' });
  const cur = () => data.providers.find((p) => p.id === pick);
  const draw = () => {
    clear(list).append(...data.providers.map((p) => h('button', { type: 'button', class: 'choice', role: 'radio', 'aria-checked': String(p.id === pick), onclick: () => { pick = p.id; model.value = p.models?.[0] || ''; draw(); } },
      h('strong', null, p.name), h('span', { class: 'small muted' }, p.kind === 'cli' ? 'Command-line agent' : 'Any OpenAI-compatible API'),
      p.kind === 'cli' ? badge(p.detected ? 'Found on this machine' : 'Not installed', p.detected ? 'ok' : 'warn') : badge('Needs a URL and key'))));
    models.replaceChildren(...(cur()?.models || []).map((m) => h('option', { value: m })));
    const act = data.active?.provider === pick ? data.active : {};
    clear(extra).append(...(cur()?.fields || []).map((f) => { const key = /url|base/i.test(f.key); const set = !key && f.secret && act.api_key_set;
      return field(f.title, h('input', { type: f.secret ? 'password' : 'text', 'data-key': f.key, value: key ? act.base_url || '' : '', placeholder: set ? 'Saved. Leave blank to keep it.' : f.placeholder || '', autocomplete: 'off' }), f.secret ? 'Saved in a settings file only your user can read, and never shown again.' : null); }),
      cur()?.path && h('p', { class: 'small muted' }, `Found at ${cur().path}`),
      /^https:\/\//.test(cur()?.docs_url || '') && h('a', { href: cur().docs_url, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, `${cur().name} setup guide`));
  };
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Context' });
  const ctxHelp = h('p', { class: 'help small muted' });
  const drawCtx = () => { clear(seg).append(...Object.entries(CONTEXT).map(([k, [l]]) => h('button', { type: 'button', 'aria-pressed': String(k === ctx), onclick: () => { ctx = k; drawCtx(); } }, l))); ctxHelp.textContent = CONTEXT[ctx][1]; };
  const result = h('div', { 'aria-live': 'polite' });
  const fbPick = h('select', null, h('option', { value: '' }, 'None'), ...data.providers.map((p) => h('option', { value: p.id, selected: p.id === data.fallback?.provider }, p.name)));
  const fbModel = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Optional', value: data.fallback?.model || '' });
  const payload = () => {
    const body = { provider: pick, model: model.value.trim(), context: ctx };
    for (const i of extra.querySelectorAll('[data-key]')) if (i.value.trim()) body[/url|base/i.test(i.dataset.key) ? 'base_url' : 'api_key'] = i.value.trim();
    body.fallback_provider = fbPick.value; body.fallback_model = fbPick.value ? fbModel.value.trim() : '';
    return body;
  };
  const save = btn('Save agent', () => busy(save, async () => { await send('PUT', '/api/agent/provider', payload()); toast('Agent saved'); }), { cls: 'ink' });
  const test = btn('Save and test', () => busy(test, async () => {
    await send('PUT', '/api/agent/provider', payload());
    const r = await send('POST', '/api/agent/test', {});
    clear(result).append(r.ok ? notice('ok', h('strong', null, 'Working. '), `${r.provider} / ${r.model} answered in ${r.latency_ms} ms${r.sample ? `: “${String(r.sample).slice(0, 80)}”` : '.'}`) : notice('error', h('strong', null, 'No answer. '), r.error || 'The agent did not respond.'));
  }), { cls: 'primary' });
  draw(); drawCtx();
  box.append(list, extra, field('Model', model, 'Pick a suggestion or type any model id your agent supports.'), models,
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Context'), seg, ctxHelp),
    field('Fallback agent', fbPick, 'Used when the main agent hits a limit or fails. Optional.'), field('Fallback model', fbModel), h('div', { class: 'row' }, test, save), result);
}

export async function credentialsForm(box, groups) {
  const creds = await maybe('/api/credentials'); if (!creds) return box.append(notice('warn', 'Credential editing is not available on this build.'));
  box.append(...creds.filter((c) => !groups || groups.includes(c.group)).map((c) => {
      const i = h('input', { type: c.secret === false ? 'text' : 'password', autocomplete: 'off', placeholder: c.set ? 'Saved. Type to replace.' : '' });
      const s = btn('Save', () => busy(s, async () => { if (!i.value.trim()) throw new Error('Type a value first.'); await send('PUT', '/api/credentials', { key: c.key, value: i.value.trim() }); i.value = ''; toast(`${c.title} saved`); }), { cls: 'sm ink' });
      return h('div', { class: 'card stack' }, field(c.title, i, c.hint), h('div', { class: 'row' }, s, c.set && badge('Set', 'ok'), c.group && !groups && h('span', { class: 'small muted end' }, c.group)));
    }));
}
const imagesStep = (box) => { box.append(h('p', { class: 'muted' }, 'Cadence generates every post image. Add an OpenAI key, or skip this if you run a local image gateway.')); return credentialsForm(box, ['Images', 'Media hosting']); };

function brandStep(box, ctx) {
  const url = h('input', { type: 'url', placeholder: 'https://yourbusiness.com', autocomplete: 'url' });
  const name = h('input', { type: 'text', placeholder: 'Business name', autocomplete: 'organization' });
  const brief = h('textarea', { placeholder: 'No website? Describe the business, audience and tone in a few lines.' });
  const makeSite = btn('Read my website', () => busy(makeSite, async () => {
    const raw = url.value.trim(); if (!raw) throw new Error('Enter your website address.');
    let host; try { host = new URL(raw).hostname.replace(/^www\./, ''); } catch { throw new Error('That does not look like a web address. Start with https://'); }
    const b = await send('POST', '/api/brands', { name: name.value.trim() || host, url: raw });
    await send('POST', `/api/brands/${b.id}/extract`, {}).catch(() => {});
    await loadBrands(); setBrand(b.id); window.dispatchEvent(new Event('cadence:brands'));
    toast('Brand added. Cadence is reading the site.'); ctx.next();
  }), { cls: 'primary' });
  const makeBrief = btn('Create from description', () => busy(makeBrief, async () => {
    if (!brief.value.trim()) throw new Error('Write a short description first.');
    await send('POST', '/api/agent/requests', { prompt: brief.value.trim(), mode: 'brand' });
    toast('Sent to the content agent'); ctx.go('create');
  }), { cls: 'ink' });
  box.append(state.brands.length ? notice('ok', 'You already have ', h('strong', null, brand()?.name || 'a brand'), '. Add another below or continue.') : null,
    h('div', { class: 'split' }, h('div', { class: 'card stack' }, h('h3', null, 'From a website'), field('Website', url), field('Name (optional)', name), makeSite),
      h('div', { class: 'card stack' }, h('h3', null, 'From a description'), field('Brief', brief), makeBrief)));
}

async function accountsStep(box, ctx) {
  const setup = await maybe('/api/platforms/setup');
  if (!setup) return box.append(notice('warn', 'Platform guides are not available on this build. Use Accounts to connect manually.'));
  if (!state.brandId) box.append(notice('warn', 'Add a brand in step 3 first. Accounts belong to a brand.'));
  box.append(h('p', { class: 'muted' }, 'Open a platform and follow its numbered guide. Connect one now and the rest whenever you like.'),
    h('div', { class: 'stack' }, setup.map((p) => platformCard(p, state.brandId, ctx.refresh))));
}

export default async function render(main, ctx) {
  let step = 0; try { step = Math.min(Number(sessionStorage.getItem('cadence.step') || 0), 4); } catch { /* ignore */ }
  const stepper = h('ol', { class: 'stepper', 'aria-label': 'Setup progress' });
  const body = h('div', { class: 'wizard-body stack' });
  const go = (n) => { step = Math.max(0, Math.min(4, n)); try { sessionStorage.setItem('cadence.step', String(step)); } catch { /* ignore */ } draw(); };
  const c = { next: () => go(step + 1), go: ctx.go, refresh: () => draw() };
  async function draw() {
    clear(stepper).append(...STEPS.map((s, i) => h('li', { 'aria-current': i === step ? 'step' : null, class: i < step ? 'done' : '' }, h('button', { type: 'button', onclick: () => go(i) }, h('span', { class: 'n' }, i + 1), h('span', { class: 'l' }, s)))));
    const box = h('div', { class: 'stack' }, skeleton(2));
    clear(body).append(h('h2', { id: 'step-h' }, TITLES[step]), box);
    const mine = step, fresh = h('div', { class: 'stack' });
    try { await [agentStep, imagesStep, brandStep, accountsStep, safetyForm][mine](fresh, c); } catch (e) { fresh.replaceChildren(errorBox(e, draw)); }
    if (mine !== step) return;
    box.replaceWith(fresh);
    body.append(h('div', { class: 'row wiz-nav' }, step > 0 && btn('Back', () => go(step - 1), { cls: 'ghost' }),
      step < 4 ? btn(step === 2 && !state.brands.length ? 'Skip for now' : 'Continue', () => go(step + 1), { cls: 'ink end' })
        : btn('Finish setup', () => { try { localStorage.setItem('cadence.setup', 'done'); } catch { /* ignore */ } ctx.go('inbox'); toast('Setup complete. Welcome to Cadence.'); }, { cls: 'primary end' })));
  }
  main.append(head('Let’s get you on beat', 'Five short steps. Everything can be changed later in Settings, and this guide stays one click away.'), stepper, body);
  await draw();
}
