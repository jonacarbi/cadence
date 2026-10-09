// Settings: every dial in one place, grouped by what it protects. Re-open the setup guide from here.
import { h, clear, field, notice, errorBox, skeleton, head, btn, busy, toast } from '../ui.js';
import { get, send, maybe } from '../api.js';
import { agentStep, credentialsForm } from './setup.js';
import { safetyForm } from './safety.js';

const section = (title, lede) => { const body = h('div', { class: 'stack' }, skeleton(1)); return [h('section', { class: 'section', 'aria-label': title }, h('header', null, h('h2', null, title), lede && h('p', { class: 'muted' }, lede)), body), body]; };
const fill = async (body, fn) => { const box = h('div', { class: 'stack' }); try { await fn(box); } catch (e) { box.replaceChildren(errorBox(e, () => fill(body, fn))); } body.replaceWith(box); };

async function automation(box) {
  const s = await get('/api/settings');
  const on = (k) => s[k] === 'on' || s[k] === '1' || s[k] === 'true';
  const loop = h('input', { type: 'checkbox', checked: on('design_loop') }), plan = h('input', { type: 'checkbox', checked: on('auto_plan') });
  const tz = h('input', { type: 'text', value: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, placeholder: 'e.g. America/Paramaribo' });
  const hook = h('input', { type: 'url', value: s.webhook_url || '', placeholder: 'https://example.com/cadence-hook' });
  const secret = h('input', { type: 'password', autocomplete: 'off', placeholder: s.webhook_secret_set ? 'Saved. Type to replace.' : 'Used to sign each webhook' });
  const save = btn('Save', () => busy(save, async () => {
    const body = { timezone: tz.value.trim(), webhook_url: hook.value.trim(), design_loop: loop.checked ? 'on' : 'off', auto_plan: plan.checked ? 'on' : 'off' };
    if (secret.value.trim()) body.webhook_secret = secret.value.trim();
    await send('PUT', '/api/settings', body); secret.value = ''; toast('Saved');
  }), { cls: 'primary' });
  const check = (input, t, d) => h('label', { class: 'check card' }, input, h('span', null, h('strong', null, t), h('br'), h('span', { class: 'small muted' }, d)));
  box.append(h('div', { class: 'split' }, field('Time zone', tz, 'Used when the agent picks posting times.'), field('Webhook URL', hook, 'Cadence POSTs a signed event when a post is drafted, approved, published or fails.')),
    field('Webhook signing secret', secret, 'Stored on this machine, never shown again.'),
    check(loop, 'Refine new brands automatically', 'After reading a website, three fresh critics iterate the design tokens before any post uses them. Slower, noticeably better.'),
    check(plan, 'Plan each month automatically', 'At month end Cadence replans the next month from the last brief. Drafts still wait for you under your autonomy setting.'),
    h('div', { class: 'row' }, save));
}

const ruleName = (k) => { const t = k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return (t[0].toUpperCase() + t.slice(1)).replace(/\bcta\b/i, 'CTA'); };
async function rules(box) {
  const r = await maybe('/api/rules'); if (!r) return box.append(notice('warn', 'Caption rules are not available on this build.'));
  const keys = Object.keys(r).filter((k) => !k.startsWith('_') && k !== 'regex'), fields = {};
  box.append(h('p', { class: 'muted' }, 'Every caption is checked against these before approval. "Block" stops approval; "Warn" only flags.'),
    h('div', { class: 'grid' }, keys.map((k) => {
      const rule = r[k], sev = h('select', null, ['block', 'warn'].map((o) => h('option', { value: o, selected: rule.severity === o }, o === 'block' ? 'Block approval' : 'Warn only')));
      const val = Array.isArray(rule.value) ? h('textarea', { rows: '3' }, rule.value.join('\n')) : h('input', { type: typeof rule.value === 'number' ? 'number' : 'text', value: rule.value });
      if (Array.isArray(rule.value)) val.value = rule.value.join('\n');
      fields[k] = { sev, val, rule };
      return h('div', { class: 'card stack' }, field(ruleName(k), val, rule.description || (Array.isArray(rule.value) ? 'One entry per line.' : null)), field('When it fails', sev));
    })));
  const save = btn('Save rules', () => busy(save, async () => {
    const next = { ...r };
    for (const k of keys) { const { sev, val, rule } = fields[k]; next[k] = { ...rule, severity: sev.value, value: Array.isArray(rule.value) ? val.value.split('\n').map((x) => x.trim()).filter(Boolean) : typeof rule.value === 'number' ? Number(val.value) : val.value }; }
    await send('PUT', '/api/rules', next); toast('Rules saved');
  }), { cls: 'primary' });
  box.append(h('div', { class: 'row' }, save));
}

export default async function render(main, ctx) {
  main.append(head('Settings', 'Everything you set up in the guide, plus the finer dials.'));
  const parts = [['AI agent', 'Which agent writes your posts and how much of its own memory it may use.', agentStep], ['Image generation and hosting', 'Keys are stored encrypted in a settings file only your user can read, and are never shown again.', (b) => credentialsForm(b, ['Images', 'Media hosting'])],
    ['Safety rails', 'Keep accounts looking human.', safetyForm], ['Automation and webhooks', null, automation], ['Caption rules', null, rules]];
  for (const [t, d, fn] of parts) { const [sec, body] = section(t, d); main.append(sec); fill(body, fn); }
  main.append(h('section', { class: 'section' }, h('header', null, h('h2', null, 'Setup guide')), h('p', { class: 'muted' }, 'Walk through the first-run guide again at any time.'), h('div', { class: 'row' }, btn('Open setup guide', () => { try { sessionStorage.setItem('cadence.step', '0'); } catch { /* ignore */ } ctx.go('setup'); }, { cls: 'ink' }))));
}
