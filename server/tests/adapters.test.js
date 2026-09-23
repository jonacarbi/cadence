// Contract test for every publish adapter that had none. Each one goes through the registry wrapper —
// the same path the scheduler uses — against a mocked fetch, so it needs no third-party credentials.
// What it pins down: the request carries the credential and the post text, a receipt {id,url} comes back,
// and a rejection is classified so the scheduler knows whether to retry or pause the lane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cadence-adapters-'));
process.env.CADENCE_DIR = dir;
process.env.SUPABASE_URL = 'https://storage.example';   // Read once at import: set before the registry loads.
process.env.SUPABASE_SERVICE_KEY = 'service-key';

const IMAGE = join(dir, 'art.png');
writeFileSync(IMAGE, Buffer.from('89504e470d0a1a0a', 'hex'));

const { providerFor } = await import('../src/providers/index.js');
await import('../src/providers/registry.js'); // registers every adapter

const post = (platform, text, extra = {}) => ({ id: 'p1', copy: { [platform]: text }, alt_text: 'A quiet desk', assets: {}, format: 'single', ...extra });

/** Mock fetch with a list of [match, handler]; records every request for assertions. */
function route(t, table) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    const hit = table.find(([match]) => href.includes(match));
    if (!hit) throw new Error(`unexpected request: ${href}`);
    return hit[1](options, href);
  });
  return calls;
}
const body = (call) => JSON.parse(call.options.body);
const supabase = ['storage.example', () => Response.json({ Key: 'ok' })];

test('Facebook uploads each photo unpublished, then attaches them to one feed post', async (t) => {
  const calls = route(t, [
    ['/photos', () => Response.json({ id: 'photo-1' })],
    ['/feed', (o) => { assert.equal(body({ options: o }).attached_media[0].media_fbid, 'photo-1'); return Response.json({ id: 'page_post-1' }); }],
  ]);
  const res = await providerFor('facebook').publish({ post: post('facebook', 'A grounded update', { image_path: IMAGE }), account: { id: 'a', external_id: 'page-9' }, auth: { access_token: 'user', page_token: 'page-secret' } });
  assert.equal(res.id, 'page_post-1');
  assert.equal(res.url, 'https://www.facebook.com/page_post-1');
  assert.ok(calls[0].url.includes('/page-9/photos'));
  assert.equal(body(calls[1]).access_token, 'page-secret'); // The page token, not the user token.
  assert.equal(body(calls[1]).message, 'A grounded update');
});

test('Mastodon posts to the account instance with its bearer token', async (t) => {
  const calls = route(t, [['/api/v1/statuses', () => Response.json({ id: '110', url: 'https://social.example/@studio/110' })]]);
  const res = await providerFor('mastodon').publish({ post: post('mastodon', 'A short note'), account: { id: 'a' }, auth: { instance: 'https://social.example/', access_token: 'masto-token' } });
  assert.equal(res.url, 'https://social.example/@studio/110');
  assert.equal(calls[0].url, 'https://social.example/api/v1/statuses'); // Trailing slash trimmed, not doubled.
  assert.equal(calls[0].options.headers.authorization, 'Bearer masto-token');
  assert.equal(body(calls[0]).status, 'A short note');
});

test('Telegram sends a captioned photo to the configured chat', async (t) => {
  const calls = route(t, [['/sendPhoto', () => Response.json({ result: { message_id: 42 } })]]);
  const res = await providerFor('telegram').publish({ post: post('telegram', 'A caption', { image_path: IMAGE }), account: { id: 'a' }, auth: { bot_token: 'bot-secret', chat_id: '@studio' } });
  assert.equal(res.id, '42'); // Receipts are strings everywhere else; Telegram's number must not leak through.
  assert.ok(calls[0].url.startsWith('https://api.telegram.org/botbot-secret/'));
  assert.equal(calls[0].options.body.get('chat_id'), '@studio');
  assert.equal(calls[0].options.body.get('caption'), 'A caption');
});

test('Discord posts to the webhook and waits for the message back', async (t) => {
  const calls = route(t, [['discord.com/api/webhooks/', () => Response.json({ id: 'msg-1' })]]);
  const res = await providerFor('discord').publish({ post: post('discord', 'Hello channel', { image_path: IMAGE }), account: { id: 'a' }, auth: { webhook_url: 'https://discord.com/api/webhooks/1/token' } });
  assert.equal(res.id, 'msg-1');
  assert.ok(calls[0].url.endsWith('?wait=true')); // Without wait=true Discord answers 204 with no id.
  assert.equal(JSON.parse(calls[0].options.body.get('payload_json')).content, 'Hello channel');
  assert.ok(calls[0].options.body.get('files[0]'));
});

test('Pinterest pins the image itself and splits the copy into title and description', async (t) => {
  const calls = route(t, [['/v5/pins', () => Response.json({ id: 'pin-7' })]]);
  const res = await providerFor('pinterest').publish({ post: post('pinterest', 'A bright headline\nAnd the rest of it', { image_path: IMAGE, link: 'https://studio.example' }), account: { id: 'a' }, auth: { access_token: 'pin-token', board_id: 'board-1' } });
  assert.equal(res.url, 'https://www.pinterest.com/pin/pin-7/');
  const sent = body(calls[0]);
  assert.equal(calls[0].options.headers.authorization, 'Bearer pin-token');
  assert.equal(sent.board_id, 'board-1');
  assert.equal(sent.title, 'A bright headline');
  assert.equal(sent.description, 'And the rest of it');
  assert.equal(sent.media_source.source_type, 'image_base64');
  assert.equal(sent.alt_text, 'A quiet desk');
  await assert.rejects(providerFor('pinterest').publish({ post: post('pinterest', 'x', { image_path: IMAGE }), account: { id: 'a' }, auth: { access_token: 't' } }), /no board_id/);
});

test('X uploads the media, labels it, and attaches it to the tweet', async (t) => {
  const calls = route(t, [
    ['/2/media/upload', () => Response.json({ data: { id: 'media-1' } })],
    ['/2/media/metadata', () => Response.json({})],
    ['/2/tweets', () => Response.json({ data: { id: '180' } })],
  ]);
  const res = await providerFor('x').publish({ post: post('x', 'Two hundred characters of it', { image_path: IMAGE }), account: { id: 'a' }, auth: { access_token: 'x-token' } });
  assert.equal(res.url, 'https://x.com/i/status/180');
  assert.equal(body(calls[1]).metadata.alt_text.text, 'A quiet desk'); // Alt text, not optional.
  assert.deepEqual(body(calls[2]).media.media_ids, ['media-1']);
  assert.equal(calls[2].options.headers.authorization, 'Bearer x-token');
});

test('Reddit hosts the image publicly and submits it as a link post', async (t) => {
  const calls = route(t, [supabase, ['oauth.reddit.com/api/submit', () => Response.json({ json: { data: { name: 't3_abc', url: 'https://reddit.com/r/u_studio/abc' } } })]]);
  const res = await providerFor('reddit').publish({ post: post('reddit', 'A title line\nThe body', { image_path: IMAGE }), account: { id: 'a' }, auth: { access_token: 'reddit-token', subreddit: 'u_studio' } });
  assert.equal(res.id, 't3_abc');
  const sent = new URLSearchParams(calls[1].options.body);
  assert.equal(sent.get('sr'), 'u_studio');
  assert.equal(sent.get('title'), 'A title line');
  assert.equal(sent.get('kind'), 'link');
  assert.ok(sent.get('url').startsWith('https://storage.example/storage/v1/object/public/'));
  assert.equal(calls[1].options.headers['user-agent'], 'Cadence/1.0 (macOS social manager)'); // Reddit 429s a missing UA.
  // Reddit answers 200 with an errors array instead of a status code.
  route(t, [supabase, ['api/submit', () => Response.json({ json: { errors: [['SUBREDDIT_NOEXIST', 'that subreddit does not exist']] } })]]);
  await assert.rejects(providerFor('reddit').publish({ post: post('reddit', 'A title', { image_path: IMAGE }), account: { id: 'a' }, auth: { access_token: 't', subreddit: 'nope' } }), /SUBREDDIT_NOEXIST/);
});

test('Threads creates a container, publishes it, and survives a dead permalink lookup', async (t) => {
  const calls = route(t, [
    ['/threads_publish', () => Response.json({ id: 'th-published' })],
    ['/threads', () => Response.json({ id: 'container-1' })],
    ['fields=permalink', () => Response.json({ error: 'gone' }, { status: 403 })],
  ]);
  const res = await providerFor('threads').publish({ post: post('threads', 'A text-only thread'), account: { id: 'a', external_id: 'user-1' }, auth: { access_token: 'threads-token' } });
  assert.equal(res.id, 'th-published'); // The permalink failed; the publication receipt must not be lost with it.
  assert.equal(res.url, undefined);
  assert.equal(body(calls[0]).media_type, 'TEXT');
  assert.equal(body(calls[1]).creation_id, 'container-1');
});

test('a rejection is classified so the scheduler knows whether to retry or pause the lane', async (t) => {
  const publish = (platform, auth) => providerFor(platform).publish({ post: post(platform, 'A post'), account: { id: 'a', external_id: 'x' }, auth });
  const fail = (status, payload = { error: 'no' }) => route(t, [['', () => Response.json(payload, { status })]]);
  fail(401);
  await assert.rejects(publish('mastodon', { instance: 'https://social.example', access_token: 'stale' }), (e) => e.actionBlocked === true && e.retryable === false && e.definitelyNotSent === true);
  fail(429);
  await assert.rejects(publish('discord', { webhook_url: 'https://discord.com/api/webhooks/1/t' }), (e) => e.retryable === true && e.definitelyNotSent === true);
  fail(503);
  await assert.rejects(publish('telegram', { bot_token: 'b', chat_id: '1' }), (e) => e.retryable === true && e.definitelyNotSent === false);
  fail(400, { error: { code: 368, message: 'action blocked' } });
  await assert.rejects(publish('facebook', { access_token: 't' }), (e) => e.actionBlocked === true); // Meta's 368: retrying makes it worse.
});
