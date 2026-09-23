// TikTok — Content Posting API v2. Cadence renders still frames, so posts go through the PHOTO
// content lane (PULL_FROM_URL), which needs the frames on public URLs. Scope: video.publish, which
// is what TikTok names the posting scope for photos too. The pull domain must be verified in the
// developer portal, and an unaudited client may only post privately.
import { api, bearer, refreshIfNeeded } from './http.js';
const P = 'https://open.tiktokapis.com/v2';
const creatorInfo = async (token) => (await api(`${P}/post/publish/creator_info/query/`, { method: 'POST', headers: bearer(token), json: {} })).data;

export const oauth = {
  authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
  tokenUrl: `${P}/oauth/token/`,
  scope: 'video.publish',
  pkce: false,
  clientParam: 'client_key', // TikTok names the app id client_key, and rejects client_id.
  async identity(auth) {
    const me = await creatorInfo(auth.access_token);
    return { id: me.creator_username, label: `@${me.creator_username}` };
  },
};

export async function publish({ auth: a, text, mediaUrls }) {
  const auth = await refreshIfNeeded(a, oauth.tokenUrl, { client_key: a.client_id, client_secret: a.client_secret });
  if (!mediaUrls?.length) throw new Error('tiktok: photo posts need public image URLs');
  // Ask the account which privacy levels it may use: an unaudited client that assumes
  // PUBLIC_TO_EVERYONE has the whole post rejected.
  const me = await creatorInfo(auth.access_token);
  const privacy = me.privacy_level_options?.find((p) => p === 'PUBLIC_TO_EVERYONE') || me.privacy_level_options?.[0];
  if (!privacy) throw new Error('tiktok: the account reports no usable privacy level');
  const init = await api(`${P}/post/publish/content/init/`, { method: 'POST', headers: bearer(auth.access_token), json: {
    media_type: 'PHOTO',
    post_mode: 'DIRECT_POST',
    post_info: { title: text.split('\n')[0].slice(0, 90), description: text.slice(0, 4000), privacy_level: privacy },
    source_info: { source: 'PULL_FROM_URL', photo_images: mediaUrls.slice(0, 35), photo_cover_index: 0 },
  } });
  const publishId = init.data?.publish_id;
  if (!publishId) throw new Error('tiktok: init returned no publish_id');
  // Past this point TikTok has accepted the post, so a polling failure must never read as "not sent" —
  // only TikTok saying FAILED does, and that one is rethrown.
  const postId = await settledPostId(auth.access_token, publishId).catch((e) => { if (e.definitelyNotSent) throw e; return null; });
  return { id: postId || publishId, url: postId ? `https://www.tiktok.com/@${me.creator_username}/photo/${postId}` : `https://www.tiktok.com/@${me.creator_username}`, auth };
}

/** Poll the async publish briefly. Returns null while it is still processing — the receipt stands either way. */
async function settledPostId(token, publishId) {
  for (let i = 0; i < 6; i++) {
    const s = (await api(`${P}/post/publish/status/fetch/`, { method: 'POST', headers: bearer(token), json: { publish_id: publishId } })).data;
    if (s.status === 'FAILED') { const e = new Error(`tiktok: publish failed (${s.fail_reason || 'unknown'})`); e.definitelyNotSent = true; throw e; }
    if (s.status === 'PUBLISH_COMPLETE') return s.publicaly_available_post_id?.[0] ?? null; // TikTok's spelling.
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}
