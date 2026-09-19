// LinkedIn — Community Management API (Posts API + Images API). Scopes: w_member_social (+ w_organization_social for pages).
import { readFileSync } from "node:fs";
import { api, bearer } from "./http.js";

const V = { "LinkedIn-Version": "202409", "X-Restli-Protocol-Version": "2.0.0" };
export const oauth = {
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  scope: "openid profile w_member_social",
  pkce: false,
  async identity(auth) { const me = await api("https://api.linkedin.com/v2/userinfo", { headers: bearer(auth.access_token) }); return { id: `urn:li:person:${me.sub}`, label: me.name }; },
};

async function uploadImage(auth, owner, path) {
  const init = await api("https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers: { ...bearer(auth.access_token), ...V }, json: { initializeUploadRequest: { owner } } });
  await api(init.value.uploadUrl, { method: "PUT", headers: { ...bearer(auth.access_token), "content-type": "application/octet-stream" }, body: readFileSync(path) });
  return init.value.image;
}

export async function publish({ auth, account, text, media, altText }) {
  const owner = auth.organization_urn || account.external_id;
  const images = [];
  for (const m of media) images.push(await uploadImage(auth, owner, m));
  const content = images.length === 1 ? { media: { id: images[0], altText: altText || "" } }
    : images.length > 1 ? { multiImage: { images: images.map((id) => ({ id, altText: altText || "" })) } } : undefined;
  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST", headers: { ...bearer(auth.access_token), ...V, "content-type": "application/json" },
    body: JSON.stringify({ author: owner, commentary: text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", ...(content && { content }) }),
  });
  if (!res.ok) throw new Error(`linkedin ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const id = res.headers.get("x-restli-id");
  return { id, url: `https://www.linkedin.com/feed/update/${id}` };
}

export async function metrics(auth, published) {
  const r = await api(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(published.id)}`, { headers: { ...bearer(auth.access_token), ...V } });
  return { likes: r.likesSummary?.totalLikes ?? 0, comments: r.commentsSummary?.totalFirstLevelComments ?? 0 };
}
