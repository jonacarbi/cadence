// Bridges the executable adapters (publish({auth,text,media,...}) → {id,url}) into the scheduler's
// fail-closed contract (publish({post,account,auth,idempotencyKey}); errors carry retryable/actionBlocked).
import { registerProvider, PLATFORMS } from './index.js';
import { canHost, hostPublic } from '../media.js';
import { update, encrypt } from '../db.js';
import { realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { ASSETS_DIR, BRANDS_DIR } from '../config.js';
import { refreshContext } from './http.js';
import * as x from './x.js';
import * as linkedin from './linkedin.js';
import * as instagram from './instagram.js';
import * as facebook from './facebook.js';
import * as threads from './threads.js';
import * as bluesky from './bluesky.js';
import * as mastodon from './mastodon.js';
import * as telegram from './telegram.js';
import * as discord from './discord.js';
import * as pinterest from './pinterest.js';
import * as reddit from './reddit.js';
import * as tiktok from './tiktok.js';
import * as mock from './mock.js';

/** Per-platform extras the capability table does not carry: preferred aspect, auth style, public-URL need. */
export const META = {
  x: { aspect: 'square', auth: 'oauth', mod: x },
  linkedin: { aspect: 'square', auth: 'oauth', mod: linkedin },
  instagram: { aspect: 'portrait', auth: 'oauth', needsPublicUrl: true, mod: instagram },
  facebook: { aspect: 'square', auth: 'oauth', mod: facebook },
  threads: { aspect: 'portrait', auth: 'oauth', needsPublicUrl: true, mod: threads },
  bluesky: { aspect: 'square', auth: 'manual', fields: ['handle', 'app_password'], mod: bluesky },
  mastodon: { aspect: 'square', auth: 'manual', fields: ['instance', 'access_token'], mod: mastodon },
  telegram: { aspect: 'square', auth: 'manual', fields: ['bot_token', 'chat_id'], mod: telegram },
  discord: { aspect: 'square', auth: 'manual', fields: ['webhook_url'], mod: discord },
  pinterest: { aspect: 'portrait', auth: 'oauth', mod: pinterest },
  reddit: { aspect: 'square', auth: 'oauth', needsPublicUrl: true, mod: reddit },
  tiktok: { aspect: 'portrait', auth: 'oauth', needsPublicUrl: true, mod: tiktok },
  mock: { aspect: 'square', auth: 'manual', fields: [], mod: mock },
};

function classify(platform, err) {
  const blob = `${err.status ?? ''} ${err.message} ${JSON.stringify(err.data ?? '')}`;
  // Hard blocks (Meta 368 action blocked, revoked tokens) pause the lane; 5xx/429/network are retryable.
  err.actionBlocked = !err.needsReconnect && (/368|1404|suspended|invalid_grant|revoked|checkpoint/i.test(blob) || err.status === 401);
  err.retryable = !err.actionBlocked && !err.needsReconnect && (err.status === 429 || (err.status ?? 500) >= 500 || /timeout|ECONN|fetch failed/i.test(err.message));
  // A 4xx answer from the platform means the request was rejected before anything was posted.
  err.definitelyNotSent = Boolean(err.definitelyNotSent) || (err.status >= 400 && err.status < 500);
  return err;
}

// Last line of defence: only images inside Cadence's own media folders ever leave the machine.
const MEDIA_EXT = /\.(png|jpe?g|webp|gif)$/i;
export function ownMedia(path) {
  let abs = ''; try { abs = realpathSync(path); } catch {}
  if (!MEDIA_EXT.test(abs) || ![ASSETS_DIR, BRANDS_DIR].some((root) => { try { return abs.startsWith(realpathSync(root) + sep); } catch { return false; } }))
    throw Object.assign(new Error('Refusing to upload a file outside Cadence media'), { definitelyNotSent: true, retryable: false });
  return abs;
}

function adapter(platform) {
  const m = META[platform];
  return {
    async validate({post}) {
      if(post.image_path&&PLATFORMS[platform].maxMediaChars&&[...post.copy[platform]].length>PLATFORMS[platform].maxMediaChars)throw new Error(`${PLATFORMS[platform].name} media captions exceed the platform limit`);
      if(PLATFORMS[platform].requiresMedia&&!post.image_path)throw new Error('This platform requires a finished image');
      if(m.needsPublicUrl&&post.image_path&&!canHost())throw new Error('Configure public media hosting before publishing to this platform');
    },
    async publish({ post, account, auth, idempotencyKey }) {
      const text = post.copy?.[platform] ?? '';
      const a = post.assets || {};
      const frames = (post.format === 'carousel' && a.frames?.length ? a.frames : [m.aspect === 'square' && a.square ? a.square : post.image_path].filter(Boolean)).map(ownMedia);
      let mediaUrls = [];
      try {
        if (m.needsPublicUrl && frames.length) {
          if (!canHost()) { const e = new Error(`${PLATFORMS[platform].name} needs public media URLs — set SUPABASE_URL and SUPABASE_SERVICE_KEY`); e.definitelyNotSent = true; throw e; }
          try {mediaUrls = await Promise.all(frames.map(path=>hostPublic(path)));} catch(error) {error.definitelyNotSent=true;throw error;}
        }
        // A refreshed token is saved the moment it is issued (X rotates refresh tokens), even if the publish itself then fails.
        const persist = (fresh) => update('accounts', account.id, { auth_enc: encrypt({ ...fresh, _updated: undefined }) });
        const res = await refreshContext.run({ persist }, () => m.mod.publish({ auth, account, text, media: frames, mediaUrls, altText: post.alt_text, link: post.link || null, idempotencyKey }));
        if (res.auth?._updated) update('accounts', account.id, { auth_enc: encrypt({ ...auth, ...res.auth, _updated: undefined }) });
        return { id: res.id, url: res.url };
      } catch (err) { throw classify(platform, err); }
    },
    metrics: m.mod.metrics ? (auth, published) => m.mod.metrics(auth, published) : undefined,
    auth: m.auth, fields: m.fields || [],
  };
}

for (const platform of Object.keys(META)) registerProvider(platform, adapter(platform));
