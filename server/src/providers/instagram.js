// Instagram — Graph API via Facebook Login (instagram_basic, instagram_content_publish, pages_show_list).
// Needs a public image URL: single image or carousel container → publish.
import { api, refreshMetaToken } from "./http.js";
const G = "https://graph.facebook.com/v21.0";

export const oauth = {
  authorizeUrl: "https://www.facebook.com/v21.0/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scope: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management",
  pkce: false,
  async identity(auth) {
    const pages = await api(`${G}/me/accounts?fields=instagram_business_account{id,username}&access_token=${auth.access_token}`);
    const p = pages.data.find((x) => x.instagram_business_account);
    if (!p) throw new Error("No Instagram business account linked to a Facebook Page you manage");
    return { id: p.instagram_business_account.id, label: `@${p.instagram_business_account.username}` };
  },
};

async function waitReady(auth, id) {
  for (let i = 0; i < 20; i++) {
    const s = await api(`${G}/${id}?fields=status_code&access_token=${auth.access_token}`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") throw new Error("instagram container error");
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Instagram media processing timed out before publication');
}

export async function publish({ auth: a, account, text, mediaUrls, altText }) {
  const auth = await refreshMetaToken(a, "instagram");
  const ig = account.external_id, t = auth.access_token;
  let creation;
  if (mediaUrls.length > 1) {
    const children = [];
    for (const u of mediaUrls) children.push((await api(`${G}/${ig}/media`, { method: "POST", json: { image_url: u, is_carousel_item: true, access_token: t } })).id);
    creation = (await api(`${G}/${ig}/media`, { method: "POST", json: { media_type: "CAROUSEL", children, caption: text, access_token: t } })).id;
  } else {
    creation = (await api(`${G}/${ig}/media`, { method: "POST", json: { image_url: mediaUrls[0], caption: text, alt_text: altText, access_token: t } })).id;
  }
  await waitReady(auth, creation);
  const pub = await api(`${G}/${ig}/media_publish`, { method: "POST", json: { creation_id: creation, access_token: t } });
  const info = await api(`${G}/${pub.id}?fields=permalink&access_token=${t}`).catch(()=>({}));
  return { id: pub.id, url: info.permalink, auth };
}

export async function metrics(auth, published) {
  const r = await api(`${G}/${published.id}/insights?metric=reach,likes,comments,saved,shares&access_token=${auth.access_token}`);
  return Object.fromEntries(r.data.map((m) => [m.name, m.values?.[0]?.value ?? 0]));
}

/** Meta error 368 = temporarily blocked. The breaker pauses the lane on this. */
export const isHardBlock = (err) => /"code":\s*368|error_subcode":\s*1404/.test(String(err?.message));
