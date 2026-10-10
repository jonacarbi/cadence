// Pinterest — API v5, base64 image upload. Scopes: boards:read pins:write.
import { readFileSync } from "node:fs";
import { api, bearer, refreshIfNeeded, mediaType } from "./http.js";
const P = "https://api.pinterest.com/v5";

export const oauth = {
  authorizeUrl: "https://www.pinterest.com/oauth/",
  tokenUrl: "https://api.pinterest.com/v5/oauth/token",
  scope: "boards:read,pins:read,pins:write,user_accounts:read",
  pkce: false,
  // One entry per board: the account stays the same user, only the board pins land on changes.
  async destinations(auth) {
    const me = await api(`${P}/user_account`, { headers: bearer(auth.access_token) });
    const boards = (await api(`${P}/boards?page_size=100`, { headers: bearer(auth.access_token) })).items || [];
    if (!boards.length) return [{ id: me.username, label: me.username, extraAuth: { board_id: undefined } }];
    return boards.map((b) => ({ id: me.username, key: b.id, label: `${me.username} · ${b.name}`, extraAuth: { board_id: b.id } }));
  },
};

export async function publish({ auth: a, text, media, altText, link }) {
  const auth = await refreshIfNeeded(a, oauth.tokenUrl);
  if (!auth.board_id) throw new Error("pinterest: no board_id on account");
  const [title, ...rest] = text.split("\n");
  const r = await api(`${P}/pins`, { method: "POST", headers: bearer(auth.access_token), json: {
    board_id: auth.board_id, title: title.slice(0, 100), description: rest.join("\n").slice(0, 800), alt_text: altText, link,
    media_source: { source_type: "image_base64", content_type: mediaType(media[0]), data: readFileSync(media[0]).toString("base64") },
  } });
  return { id: r.id, url: `https://www.pinterest.com/pin/${r.id}/`, auth };
}
export async function metrics(auth, published) {
  const r = await api(`${P}/pins/${published.id}/analytics?start_date=${published.date?.slice(0, 10)}&end_date=${new Date().toISOString().slice(0, 10)}&metric_types=IMPRESSION,SAVE,PIN_CLICK`, { headers: bearer(auth.access_token) });
  const s = r.all?.summary_metrics || {};
  return { impressions: s.IMPRESSION ?? 0, saves: s.SAVE ?? 0, clicks: s.PIN_CLICK ?? 0 };
}
