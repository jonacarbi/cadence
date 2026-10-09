// A post as a review card: visual, per-platform copy, lint, and every action the approval queue needs.
import { h, btn, busy, field, badge, icon, toast, scheduled, when, cap, assetUrl, tone, clear } from './ui.js';
import { get, send } from './api.js';

const LOCKED = ['publishing', 'published', 'uncertain'];
const POLL_MS = 3000, POLL_MAX = 60;
// <input type=datetime-local> speaks local wall time without a zone; the API wants ISO with one.
const localInput = (iso) => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

function lintList(lint) {
  const bad = (lint || []).filter((i) => i.severity === 'block'), warn = (lint || []).filter((i) => i.severity !== 'block');
  if (!bad.length && !warn.length) return h('p', { class: 'small ok-text' }, 'Passes every caption check.');
  return h('ul', { class: 'lint' }, [...bad, ...warn].map((i) => h('li', { class: i.severity === 'block' ? 'blocks' : '' }, h('strong', null, i.severity === 'block' ? 'Blocks approval' : 'Heads up', i.platform ? ` (${cap(i.platform)})` : '', ': '), i.message)));
}

function comments(post) {
  const box = h('div', { class: 'stack comments' }), list = h('ul', { class: 'clist' });
  const input = h('textarea', { rows: '2', placeholder: 'Leave a note for the agent or your team' });
  const load = async () => { try { const c = await get(`/api/posts/${post.id}/comments`); list.replaceChildren(...(c.length ? c.map((x) => h('li', null, h('strong', null, cap(x.author)), ' ', h('span', { class: 'small muted' }, when(x.created_at)), h('p', null, x.body))) : [h('li', { class: 'muted small' }, 'No notes yet.')])); } catch (e) { list.replaceChildren(h('li', { class: 'small' }, e.message)); } };
  const add = btn('Add note', () => busy(add, async () => { if (!input.value.trim()) return; await send('POST', `/api/posts/${post.id}/comments`, { body: input.value.trim() }); input.value = ''; await load(); }), { cls: 'sm' });
  box.append(list, field('New note', input), h('div', { class: 'row' }, add)); load(); return box;
}

export function postCard(initial, { onChange, compact = false } = {}) {
  let post = initial;
  const root = h('article', { class: `post status-${post.status}`, 'aria-label': `${post.topic || 'Post'} for ${post.platforms.join(', ')}` });
  const apply = (p) => { post = { ...post, ...p }; draw(); onChange?.(post); };
  const refetch = async () => { const all = await get(`/api/posts?brand_id=${post.brand_id}`); const fresh = all.find((p) => p.id === post.id); if (fresh) apply(fresh); return fresh; };

  function copyEditors() {
    const ta = {};
    const boxes = post.platforms.map((pl) => {
      const t = h('textarea', { rows: '4', disabled: LOCKED.includes(post.status), 'aria-label': `${cap(pl)} caption`, oninput: () => { count.textContent = `${t.value.length} characters`; } }, post.copy?.[pl] ?? '');
      t.value = post.copy?.[pl] ?? ''; ta[pl] = t;
      const count = h('span', { class: 'small muted num' }, `${t.value.length} characters`);
      return h('div', { class: 'field' }, h('div', { class: 'row' }, h('span', { class: 'label' }, cap(pl)), h('span', { class: 'end' }, count)), t);
    });
    return { boxes, read: () => Object.fromEntries(post.platforms.map((pl) => [pl, ta[pl].value])) };
  }

  // Any edit (caption or time) makes a new draft version, so a missed post comes back as a fresh delivery once re-approved.
  async function save(read, at) {
    const copy = read(), scheduled_at = at.value ? new Date(at.value).toISOString() : post.scheduled_at;
    if (JSON.stringify(copy) === JSON.stringify(post.copy) && Date.parse(scheduled_at) === Date.parse(post.scheduled_at)) return post;
    const p = await send('PATCH', `/api/posts/${post.id}`, { copy, platforms: post.platforms, scheduled_at, version: post.version });
    post = p; return p;
  }

  async function watchVisual(btnEl) {
    btnEl.textContent = 'Rendering...'; const was = post.image_path;
    for (let i = 0; i < POLL_MAX; i++) { await new Promise((r) => setTimeout(r, POLL_MS)); if (!root.isConnected) return; const f = await refetch(); if (f && f.image_path !== was) return toast('New visual ready'); }
    toast('The visual is still rendering. Check back in a minute.');
  }

  function draw() {
    const { boxes, read } = copyEditors(), fb = h('input', { type: 'text', placeholder: 'What should change? e.g. shorter, warmer, mention the sale', 'aria-label': 'Feedback for regeneration' });
    const at = h('input', { type: 'datetime-local', value: localInput(post.scheduled_at), 'aria-label': 'Publish at' });
    const locked = LOCKED.includes(post.status), blocked = (post.lint || []).some((i) => i.severity === 'block');
    const img = post.image_path ? h('img', { src: assetUrl(post.image_path), alt: post.alt_text || post.topic || 'Post visual', loading: 'lazy', width: 480, height: 480 }) : h('div', { class: 'noimg' }, h('span', null, 'Visual pending'));
    const approve = btn('Approve and schedule', () => busy(approve, async () => { await save(read, at); const p = await send('POST', `/api/posts/${post.id}/approve-and-schedule`, { version: post.version }); scheduled(p); apply(p); }), { cls: 'primary', ico: 'check', disabled: blocked, title: blocked ? 'Fix the blocking caption issues first' : '' });
    const saveB = btn('Save edits', () => busy(saveB, async () => { await save(read, at); toast('Saved'); apply(post); }), { cls: 'sm' });
    const reject = btn('Reject', () => busy(reject, async () => { apply(await send('POST', `/api/posts/${post.id}/reject`, { version: post.version })); toast('Rejected'); }), { cls: 'sm danger ghost' });
    const regen = btn('Regenerate', () => busy(regen, async () => { regen.textContent = 'Rewriting (can take minutes)...'; apply(await send('POST', `/api/posts/${post.id}/regenerate`, { feedback: fb.value.trim(), fresh_image: false })); toast('Rewritten'); }), { cls: 'sm', ico: 'refresh' });
    const visual = btn('New visual', () => busy(visual, async () => { await send('POST', `/api/posts/${post.id}/rerender`, { fresh_image: true }); await watchVisual(visual); }), { cls: 'sm' });
    const notes = h('div', { hidden: true }), nb = btn('Notes', () => { if (notes.hidden) { notes.hidden = false; notes.replaceChildren(comments(post)); } else notes.hidden = true; }, { cls: 'sm ghost' });
    clear(root).append(
      h('div', { class: 'post-vis' }, img),
      h('div', { class: 'post-main stack' },
        h('div', { class: 'row' }, ...post.platforms.map((p) => badge(cap(p))), badge(cap(post.status), tone(post.status)), h('time', { class: 'small muted end', datetime: post.scheduled_at }, when(post.scheduled_at))),
        post.topic && h('h3', null, post.topic),
        ...boxes, lintList(post.lint),
        post.error && h('p', { class: 'small err-text' }, post.error),
        !locked && h('div', { class: 'field' }, h('label', { class: 'label' }, post.status === 'missed' ? 'Missed its slot. Pick a new time, then approve' : 'Publish at'), at),
        !locked && !compact && h('div', { class: 'field' }, h('label', { class: 'label' }, 'Ask for changes'), fb),
        h('div', { class: 'row actions' }, !locked && ['draft', 'rejected', 'missed'].includes(post.status) && approve, !locked && saveB, !locked && regen, !locked && visual, !locked && post.status !== 'rejected' && reject, nb),
        notes));
  }
  draw(); return root;
}
