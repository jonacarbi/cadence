// Reddit — OAuth2 (submit, identity). Image posts link to the public media URL.
import { api, refreshIfNeeded } from "./http.js";
const UA = "Cadence/1.0 (macOS social manager)";

export const oauth = {
  authorizeUrl: "https://www.reddit.com/api/v1/authorize?duration=permanent",
  tokenUrl: "https://www.reddit.com/api/v1/access_token",
  scope: "identity submit read",
  pkce: false,
  async identity(auth) { const me = await api("https://oauth.reddit.com/api/v1/me", { headers: { authorization: `Bearer ${auth.access_token}`, "user-agent": UA } }); return { id: me.name, label: `u/${me.name}`, extraAuth: { subreddit: `u_${me.name}` } }; }, // Profile subreddit: posts work the moment the account connects.
};

export async function publish({ auth: a, text, mediaUrls }) {
  const auth = await refreshIfNeeded(a, oauth.tokenUrl);
  if (!auth.subreddit) throw new Error("reddit: subreddit not set on account");
  const [title, ...rest] = text.split("\n");
  const body = new URLSearchParams({ sr: auth.subreddit, title: title.slice(0, 300), api_type: "json", ...(mediaUrls[0] ? { kind: "link", url: mediaUrls[0] } : { kind: "self", text: rest.join("\n") }) });
  const r = await api("https://oauth.reddit.com/api/submit", { method: "POST", headers: { authorization: `Bearer ${auth.access_token}`, "user-agent": UA, "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  if (r.json?.errors?.length) throw new Error(`reddit: ${JSON.stringify(r.json.errors)}`);
  return { id: r.json.data.name, url: r.json.data.url, auth };
}
