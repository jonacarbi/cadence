// OAuth2 connect flow: /oauth/start/:platform → provider consent → /oauth/callback → account row.
// App credentials (client id/secret) come from env: CADENCE_<PLATFORM>_CLIENT_ID / _CLIENT_SECRET.
import { randomBytes, createHash } from "node:crypto";
import { BASE_URL } from "./config.js";
import { PLATFORMS } from "./providers/index.js";
import { META } from "./providers/registry.js";
import { insert, encrypt, logEvent } from "./db.js";

const pending = new Map(); // state → {platform, verifier, brandId, createdAt}

export function creds(platform) {
  const P = platform.toUpperCase();
  return { client_id: process.env[`CADENCE_${P}_CLIENT_ID`] || "", client_secret: process.env[`CADENCE_${P}_CLIENT_SECRET`] || "" };
}
export const redirectUri = () => `${BASE_URL}/oauth/callback`;

export function startUrl(platform, brandId) {
  const def = META[platform]?.mod?.oauth;
  if (!def) throw new Error(`${platform} does not use OAuth`);
  const { client_id } = creds(platform);
  if (!client_id) throw new Error(`Missing CADENCE_${platform.toUpperCase()}_CLIENT_ID (create an app on the ${PLATFORMS[platform].name} developer portal, redirect URI ${redirectUri()})`);
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  pending.set(state, { platform, verifier, brandId, createdAt: Date.now() });
  const u = new URL(def.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client_id);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", def.scope);
  u.searchParams.set("state", state);
  if (def.pkce) { u.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url")); u.searchParams.set("code_challenge_method", "S256"); }
  return u.toString();
}

export async function finish(query) {
  const p = pending.get(query.state);
  if (!p) throw new Error("unknown or expired OAuth state");
  pending.delete(query.state);
  if (query.error) throw new Error(`${p.platform}: ${query.error_description || query.error}`);
  const def = META[p.platform].mod.oauth;
  const { client_id, client_secret } = creds(p.platform);
  const params = new URLSearchParams({ grant_type: "authorization_code", code: query.code, redirect_uri: redirectUri(), client_id });
  if (def.pkce) params.set("code_verifier", p.verifier);
  if (client_secret) params.set("client_secret", client_secret);
  const headers = { "content-type": "application/x-www-form-urlencoded", "user-agent": "Cadence/1.0" };
  if (["x", "reddit"].includes(p.platform)) headers.authorization = "Basic " + Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(def.tokenUrl, { method: "POST", headers, body: params.toString() });
  const tok = await res.json();
  if (!res.ok || !tok.access_token) throw new Error(`${p.platform} token exchange failed: ${JSON.stringify(tok).slice(0, 300)}`);
  let auth = { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null, client_id, client_secret };
  if (["instagram", "facebook"].includes(p.platform)) auth = await longLivedMeta(auth);
  const who = await def.identity(auth);
  if (who.extraAuth) auth = { ...auth, ...who.extraAuth };
  const id = insert("accounts", { brand_id: p.brandId, platform: p.platform, label: who.label, external_id: who.id, auth_enc: encrypt(auth) });
  logEvent("info", "account.connected", `${PLATFORMS[p.platform].name} ${who.label}`, { id, brandId: p.brandId });
  return { id, platform: p.platform, label: who.label };
}

async function longLivedMeta(auth) {
  const u = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  u.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: auth.client_id, client_secret: auth.client_secret, fb_exchange_token: auth.access_token });
  const r = await fetch(u).then((x) => x.json());
  return r.access_token ? { ...auth, access_token: r.access_token, expires_at: Date.now() + (r.expires_in || 5184000) * 1000 } : auth;
}

/** Non-OAuth accounts (Bluesky app password, Mastodon token, Telegram bot, Discord webhook). Validates by probing. */
export async function addManualAccount(brandId, platform, fields) {
  const P = META[platform];
  if (!P) throw new Error(`unknown platform ${platform}`);
  let label = fields.label || PLATFORMS[platform].name, external = null;
  if (platform === "bluesky") { const s = await P.mod.login(fields); label = `@${s.handle}`; external = s.did; }
  if (platform === "mastodon") { const r = await fetch(`${fields.instance.replace(/\/$/, "")}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${fields.access_token}` } }); if (!r.ok) throw new Error("mastodon token rejected"); const me = await r.json(); label = `@${me.username}@${new URL(fields.instance).host}`; external = me.id; }
  if (platform === "telegram") { const r = await fetch(`https://api.telegram.org/bot${fields.bot_token}/getMe`).then((x) => x.json()); if (!r.ok) throw new Error("telegram bot token rejected"); label = `${r.result.username} → ${fields.chat_id}`; }
  if (platform === "discord") { const r = await fetch(fields.webhook_url); if (!r.ok) throw new Error("discord webhook rejected"); const w = await r.json(); label = `#${w.name}`; }
  const id = insert("accounts", { brand_id: brandId, platform, label, external_id: external, auth_enc: encrypt(fields) });
  logEvent("info", "account.connected", `${PLATFORMS[platform].name} ${label}`, { id, brandId });
  return { id, platform, label };
}
