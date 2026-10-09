// X (Twitter) — API v2 with OAuth 2.0 PKCE (tweet.write, users.read, media.write, offline.access).
import { readFileSync } from "node:fs";
import { api, bearer, refreshIfNeeded, mediaType } from "./http.js";

export const oauth = {
  authorizeUrl: "https://x.com/i/oauth2/authorize",
  tokenUrl: "https://api.x.com/2/oauth2/token",
  scope: "tweet.read tweet.write users.read media.write offline.access",
  pkce: true,
  async identity(auth) { const me = await api("https://api.x.com/2/users/me", { headers: bearer(auth.access_token) }); return { id: me.data.id, label: `@${me.data.username}` }; },
};

async function uploadMedia(auth, path) {
  const bytes = readFileSync(path);
  const r = await api("https://api.x.com/2/media/upload", {
    method: "POST", headers: bearer(auth.access_token),
    form: { media: new Blob([bytes], { type: mediaType(path) }), media_category: "tweet_image" },
  });
  return r.data?.id || r.media_id_string;
}

export async function publish({ auth: a, text, media, altText }) {
  const auth = await refreshIfNeeded(a, oauth.tokenUrl, a.client_secret ? {} : { client_id: a.client_id });
  const ids = [];
  for (const m of media) {
    const id = await uploadMedia(auth, m);
    if (altText) await api("https://api.x.com/2/media/metadata", { method: "POST", headers: bearer(auth.access_token), json: { id, metadata: { alt_text: { text: altText.slice(0, 1000) } } } }).catch(() => {});
    ids.push(id);
  }
  const r = await api("https://api.x.com/2/tweets", { method: "POST", headers: bearer(auth.access_token), json: { text, ...(ids.length && { media: { media_ids: ids } }) } });
  return { id: r.data.id, url: `https://x.com/i/status/${r.data.id}`, auth };
}

export async function metrics(auth, published) {
  const r = await api(`https://api.x.com/2/tweets/${published.id}?tweet.fields=public_metrics`, { headers: bearer(auth.access_token) });
  const m = r.data.public_metrics;
  return { impressions: m.impression_count, likes: m.like_count, reposts: m.retweet_count, replies: m.reply_count, bookmarks: m.bookmark_count };
}
