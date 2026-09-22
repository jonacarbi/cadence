// Mastodon — any instance, personal access token with write:media write:statuses.
import { readFileSync } from "node:fs";
import { api, bearer, mediaType } from "./http.js";

export async function publish({ auth, text, media, altText }) {
  const base = auth.instance.replace(/\/$/, "");
  const ids = [];
  for (const m of media.slice(0, 4)) {
    const r = await api(`${base}/api/v2/media`, { method: "POST", headers: bearer(auth.access_token), form: { file: new Blob([readFileSync(m)], { type: mediaType(m) }), description: altText || "" } });
    ids.push(r.id);
  }
  if (ids.length) await new Promise((r) => setTimeout(r, 2000));
  const r = await api(`${base}/api/v1/statuses`, { method: "POST", headers: bearer(auth.access_token), json: { status: text, media_ids: ids } });
  return { id: r.id, url: r.url };
}
export async function metrics(auth, published) {
  const r = await api(`${auth.instance.replace(/\/$/, "")}/api/v1/statuses/${published.id}`, { headers: bearer(auth.access_token) });
  return { likes: r.favourites_count, boosts: r.reblogs_count, replies: r.replies_count };
}
