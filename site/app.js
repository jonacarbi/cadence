// Single source of truth for install commands (displayed per OS).
const CMD = {
  base: ['git clone https://github.com/jonacarbi/cadence.git', 'cd cadence', 'npm run setup', 'npm start', '# in a second terminal:', 'npm run open'],
};
const pre = document.querySelector('#cmds code');
if (pre) pre.textContent = CMD.base.join('\n');

const tabs = [...document.querySelectorAll('[role=tab]')];
const show = t => {
  tabs.forEach(x => {
    const on = x === t;
    x.setAttribute('aria-selected', on);
    x.tabIndex = on ? 0 : -1;
    document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
  });
};
tabs.forEach((t, i) => {
  t.addEventListener('click', () => show(t));
  t.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    n.focus(); show(n);
  });
});
const os = /Win/.test(navigator.platform) ? 'win' : /Linux|X11/.test(navigator.platform) ? 'lin' : 'mac';
show(document.getElementById('t-' + os));

document.querySelector('.copy')?.addEventListener('click', async e => {
  try { await navigator.clipboard.writeText(pre.textContent); e.target.textContent = 'Copied'; }
  catch { e.target.textContent = 'Select and copy'; }
  setTimeout(() => (e.target.textContent = 'Copy'), 1800);
});

const root = document.documentElement;
try { const s = localStorage.getItem('theme'); if (s) root.dataset.theme = s; } catch {}
document.getElementById('theme')?.addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
});

// Sample run in the hero: five panes, auto-advancing until the visitor takes over.
const cal = document.getElementById('cal');
if (cal) {
  const plan = { 2: 1, 4: 2, 7: 3, 9: 1, 11: 2, 14: 3, 16: 1, 18: 2, 21: 3, 23: 1, 25: 2, 28: 3 };
  cal.append(...Array.from({ length: 35 }, (_, d) => {
    const i = document.createElement('i');
    if (plan[d]) i.dataset.p = plan[d];
    return i;
  }));
}
const stepBtns = [...document.querySelectorAll('[data-step]')];
const panes = [...document.querySelectorAll('[data-pane]')];
let step = 0, timer, held = false;
const go = n => {
  step = n;
  stepBtns.forEach((b, i) => b.setAttribute('aria-pressed', i === n));
  panes.forEach((p, i) => p.classList.toggle('is-on', i === n));
};
const stop = () => clearInterval(timer);
stepBtns.forEach((b, i) => b.addEventListener('click', () => { held = true; stop(); go(i); }));
if (panes.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const start = () => { stop(); if (!held) timer = setInterval(() => go((step + 1) % panes.length), 3400); };
  const win = document.querySelector('.win');
  win.addEventListener('pointerenter', stop);
  win.addEventListener('pointerleave', start);
  win.addEventListener('focusin', stop);
  start();
}
