// Facebook Pages — Graph API. Photos upload directly (multipart), text posts via /feed.
import { readFileSync } from "node:fs";
import { api, mediaType } from "./http.js";
const G = "https://graph.facebook.com/v21.0";

export const oauth = {
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scope: "pages_show_list,pages_manage_posts,pages_read_engagement,business_management",
  pkce: false,
  async identity(auth) {
    const pages = await api(`${G}/me/accounts?fields=id,name,access_token&access_token=${auth.access_token}`);
    const p = pages.data[0];
    if (!p) throw new Error("No Facebook Page found");
    return { id: p.id, label: p.name, extraAuth: { page_token: p.access_token } };
  },
};

export async function publish({ auth, account, text, media }) {
  const page = account.external_id, t = auth.page_token || auth.access_token;
  if (!media.length) {
    const r = await api(`${G}/${page}/feed`, { method: "POST", json: { message: text, access_token: t } });
    return { id: r.id, url: `https://www.facebook.com/${r.id}` };
  }
  const ids = [];
  for (const m of media) {
    const r = await api(`${G}/${page}/photos`, { method: "POST", form: { source: new Blob([readFileSync(m)], { type: mediaType(m) }), published: "false", access_token: t } });
    ids.push(r.id);
  }
  const r = await api(`${G}/${page}/feed`, { method: "POST", json: { message: text, attached_media: ids.map((media_fbid) => ({ media_fbid })), access_token: t } });
  return { id: r.id, url: `https://www.facebook.com/${r.id}` };
}

export async function metrics(auth, published) {
  const r = await api(`${G}/${published.id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${auth.page_token || auth.access_token}`);
  return { likes: r.likes?.summary?.total_count ?? 0, comments: r.comments?.summary?.total_count ?? 0, shares: r.shares?.count ?? 0 };
}
