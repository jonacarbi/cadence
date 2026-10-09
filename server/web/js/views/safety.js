// Safety rails form (wizard step 5 and Settings). Each control explains, in plain words, how it prevents bans.
import { h, btn, busy, field, notice, toast } from '../ui.js';
import { get, send } from '../api.js';

const LEVELS = [
  ['review_all', 'Review everything', 'Every post waits for your approval. The safest start.'],
  ['auto_trusted', 'Auto for trusted accounts', 'Ready posts on accounts you marked trusted schedule themselves; the rest wait.'],
  ['hands_off', 'Hands off', 'Every ready post schedules itself. You get webhooks, not questions.'],
];
const num = (key, label, help, ph, max) => ({ key, label, help, ph, max });
const NUMBERS = [
  num('cap_per_account_per_day', 'Posts per account per day', 'Platforms flag accounts that suddenly post far more than a person would. A low daily cap keeps you inside normal human volume.', 'e.g. 3'),
  num('min_gap_minutes', 'Minimum gap between posts (minutes)', 'Back-to-back posts look automated. A gap spaces them out the way a person would.', 'e.g. 90', 1440),
  num('jitter_minutes', 'Timing jitter (minutes)', 'Posting at exactly 10:00:00 every day is a bot fingerprint. Jitter moves each post by a random few minutes, either way.', 'e.g. 12', 120),
  num('stale_after_hours', 'Hold overdue posts after (hours)', 'If this computer was asleep, a very late post is held for review instead of going out at a strange hour.', 'e.g. 6', 168),
];

export async function safetyForm(box) {
  const s = await get('/api/settings');
  let autonomy = s.autonomy || 'review_all', warmup = s.warmup === 'on';
  const levels = h('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'Autonomy' });
  const drawLevels = () => levels.replaceChildren(...LEVELS.map(([k, t, d]) => h('button', { type: 'button', class: 'choice wide', role: 'radio', 'aria-checked': String(k === autonomy), onclick: () => { autonomy = k; drawLevels(); } }, h('strong', null, t), h('span', { class: 'small muted' }, d))));
  drawLevels();
  const inputs = Object.fromEntries(NUMBERS.map((n) => [n.key, h('input', { type: 'number', min: '0', max: n.max, inputmode: 'numeric', placeholder: n.ph, value: s[n.key] ?? '' })]));
  const wu = h('input', { type: 'checkbox', checked: warmup, onchange: (e) => { warmup = e.target.checked; } });
  const save = btn('Save safety settings', () => busy(save, async () => {
    const body = { autonomy }; if ('warmup' in s || warmup) body.warmup = warmup ? 'on' : 'off';
    for (const n of NUMBERS) if (n.key in s || inputs[n.key].value !== '') body[n.key] = String(inputs[n.key].value).trim();
    await send('PUT', '/api/settings', body); toast('Safety settings saved');
  }), { cls: 'primary' });
  box.append(notice('ok', 'Cadence is built to look like a careful person, not a script. These rails are what keep accounts from being limited.'),
    h('div', { class: 'stack' }, h('h3', null, 'How much runs without you'), levels),
    h('div', { class: 'grid' }, NUMBERS.map((n) => h('div', { class: 'card stack' }, field(n.label, inputs[n.key], n.help)))),
    h('label', { class: 'check card' }, wu, h('span', null, h('strong', null, 'Warm up new accounts'), h('br'), h('span', { class: 'small muted' }, 'Fresh or quiet accounts start at one post a day and grow slowly. A brand-new account that suddenly posts daily is the single most common reason for a ban.'))),
    h('div', { class: 'row' }, save));
}
