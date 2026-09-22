// Threads API — needs public image URLs. threads_basic, threads_content_publish.
import { api } from "./http.js";
const T = "https://graph.threads.net/v1.0";

export const oauth = {
  authorizeUrl: "https://threads.net/oauth/authorize",
  tokenUrl: "https://graph.threads.net/oauth/access_token",
  scope: "threads_basic,threads_content_publish,threads_manage_insights",
  pkce: false,
  async identity(auth) { const me = await api(`${T}/me?fields=id,username&access_token=${auth.access_token}`); return { id: me.id, label: `@${me.username}` }; },
};

export async function publish({ auth, account, text, mediaUrls, altText }) {
  const u = account.external_id, t = auth.access_token;
  let creation;
  if (mediaUrls.length > 1) {
    const children = [];
    for (const url of mediaUrls) children.push((await api(`${T}/${u}/threads`, { method: "POST", json: { media_type: "IMAGE", image_url: url, is_carousel_item: true, alt_text: altText, access_token: t } })).id);
    creation = (await api(`${T}/${u}/threads`, { method: "POST", json: { media_type: "CAROUSEL", children: children.join(","), text, access_token: t } })).id;
  } else if (mediaUrls.length === 1) {
    creation = (await api(`${T}/${u}/threads`, { method: "POST", json: { media_type: "IMAGE", image_url: mediaUrls[0], text, alt_text: altText, access_token: t } })).id;
  } else {
    creation = (await api(`${T}/${u}/threads`, { method: "POST", json: { media_type: "TEXT", text, access_token: t } })).id;
  }
  await new Promise((r) => setTimeout(r, 5000)); // Meta recommends waiting before publish
  const pub = await api(`${T}/${u}/threads_publish`, { method: "POST", json: { creation_id: creation, access_token: t } });
  const info = await api(`${T}/${pub.id}?fields=permalink&access_token=${t}`).catch(()=>({}));
  return { id: pub.id, url: info.permalink };
}

export async function metrics(auth, published) {
  const r = await api(`${T}/${published.id}/insights?metric=views,likes,replies,reposts&access_token=${auth.access_token}`);
  return Object.fromEntries(r.data.map((m) => [m.name, m.values?.[0]?.value ?? 0]));
}
