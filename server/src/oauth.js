// OAuth2 connect flow: /oauth/start/:platform → provider consent → /oauth/callback → account row.
// App credentials (client id/secret) come from env: CADENCE_<PLATFORM>_CLIENT_ID / _CLIENT_SECRET.
import { randomBytes, createHash } from "node:crypto";
import { redirectFor } from "./platforms-setup.js";
import { PLATFORMS } from "./providers/index.js";
import { META } from "./providers/registry.js";
import { insert, update, encrypt, decrypt, logEvent, hydrate, one, all } from "./db.js";
import { fetchPublic } from './network.js';
import { WorkflowError } from "./workflow.js";

const pending = new Map(); // state → {platform, verifier, brandId, createdAt}

export function creds(platform) {
  const P = platform.toUpperCase();
  return { client_id: process.env[`CADENCE_${P}_CLIENT_ID`] || "", client_secret: process.env[`CADENCE_${P}_CLIENT_SECRET`] || "" };
}
export const redirectUri = redirectFor;

// Outcome per sign-in attempt, so the UI can tell "reconnected" apart from "still waiting" (a reconnect adds no row).
const attempts = new Map();
export const attemptStatus = (state) => attempts.get(state) || { status: "unknown" };

export function startUrl(platform, brandId) {
  for(const [state,p] of pending)if(Date.now()-p.createdAt>600000)pending.delete(state);
  for (const [state, a] of attempts) if (Date.now() - a.at > 900000) attempts.delete(state);
  const def = META[platform]?.mod?.oauth;
  if (!def) throw new Error(`${platform} does not use OAuth`);
  const { client_id } = creds(platform);
  if (!client_id) throw new Error(`Missing CADENCE_${platform.toUpperCase()}_CLIENT_ID (create an app on the ${PLATFORMS[platform].name} developer portal, redirect URI ${redirectUri(platform)})`);
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  const redirect = redirectUri(platform); // remembered: the token exchange must send the byte-identical value
  pending.set(state, { platform, verifier, brandId, redirect, createdAt: Date.now() });
  attempts.set(state, { status: "pending", at: Date.now() });
  const u = new URL(def.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set(def.clientParam || "client_id", client_id);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("scope", def.scope);
  u.searchParams.set("state", state);
  if (def.pkce) { u.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url")); u.searchParams.set("code_challenge_method", "S256"); }
  return { url: u.toString(), state };
}

export async function finish(query) {
  const record = (a) => { if (attempts.has(query.state)) attempts.set(query.state, { ...a, at: Date.now() }); };
  try { const account = await exchange(query); record({ status: "done", account }); return account; }
  catch (e) { record({ status: "error", error: e.message }); throw e; }
}

async function exchange(query) {
  const p = pending.get(query.state);
  if (!p || Date.now()-p.createdAt>600000) {pending.delete(query.state);throw new Error("unknown or expired OAuth state");}
  pending.delete(query.state);
  if (query.error) throw new Error(`${p.platform}: ${query.error_description || query.error}`);
  if(typeof query.code!=='string'||!query.code)throw new Error('OAuth authorization code is missing');
  const def = META[p.platform].mod.oauth;
  const { client_id, client_secret } = creds(p.platform);
  const idParam = def.clientParam || "client_id";
  const params = new URLSearchParams({ grant_type: "authorization_code", code: query.code, redirect_uri: p.redirect, [idParam]: client_id });
  if (def.pkce) params.set("code_verifier", p.verifier);
  // X (confidential apps), Reddit and Pinterest authenticate the app with HTTP Basic; the rest take the secret in the body.
  const basic = ["reddit", "pinterest"].includes(p.platform) || (p.platform === "x" && client_secret);
  if (client_secret && !basic) params.set("client_secret", client_secret);
  const headers = { "content-type": "application/x-www-form-urlencoded", "user-agent": "Cadence/1.0" };
  if (basic) headers.authorization = "Basic " + Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(def.tokenUrl, { method: "POST", headers, body: params.toString(), signal:AbortSignal.timeout(20000) });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) throw new Error(`${PLATFORMS[p.platform].name} refused the sign-in (${res.status}${tok.error_description || tok.error ? `: ${tok.error_description || tok.error}` : ""}). Check the Client ID/secret and that the redirect URI in the developer portal is exactly ${p.redirect}.`);
  let auth = { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null, client_id, client_secret };
  if (["instagram", "facebook"].includes(p.platform)) auth = await longLivedMeta(auth);
  if (p.platform === "threads") auth = await longLivedThreads(auth);
  const who = def.destinations ? (await def.destinations(auth))[0] : await def.identity(auth);
  if (who.extraAuth) auth = { ...auth, ...who.extraAuth };
  // Reconnecting the same account refreshes it in place (history and schedule stay attached) and clears the "reconnect" flag.
  const known = one("SELECT id FROM accounts WHERE brand_id IS ? AND platform = ? AND external_id = ?", p.brandId, p.platform, String(who.id));
  const id = known ? known.id : insert("accounts", { brand_id: p.brandId, platform: p.platform, label: who.label, external_id: who.id, auth_enc: encrypt(auth) });
  if (known) update("accounts", id, { label: who.label, auth_enc: encrypt(auth), failures: 0, last_error: null, paused: 0, needs_reconnect: 0 });
  logEvent("info", "account.connected", `${PLATFORMS[p.platform].name} ${who.label}`, { id, brandId: p.brandId });
  return { id, platform: p.platform, label: who.label };
}

const destKey = (d) => String(d.key ?? d.id);
async function destinationsFor(accountId) {
  const account = one("SELECT * FROM accounts WHERE id = ?", accountId);
  if (!account) throw new WorkflowError("Account not found", 404);
  const def = META[account.platform]?.mod.oauth;
  if (!def?.destinations) throw new WorkflowError("This platform has a single destination per account");
  const auth = decrypt(account.auth_enc);
  return { account, auth, list: await def.destinations(auth) };
}

/** Pages, Instagram accounts or boards this sign-in can post to. Never returns their tokens. */
export async function listDestinations(accountId) {
  const { account, auth, list } = await destinationsFor(accountId);
  const current = (d) => String(d.id) === String(account.external_id) && (d.extraAuth?.board_id ?? null) === (auth.board_id ?? null);
  return list.map((d) => ({ key: destKey(d), label: d.label, current: current(d) }));
}

/** Point an account at another destination from the same sign-in; history and schedule stay attached to the row. */
export async function setDestination(accountId, key) {
  const { account, auth, list } = await destinationsFor(accountId);
  const d = list.find((x) => destKey(x) === String(key));
  if (!d) throw new WorkflowError("That destination is not available to this sign-in");
  if (one("SELECT id FROM accounts WHERE brand_id IS ? AND platform = ? AND external_id = ? AND id != ?", account.brand_id, account.platform, String(d.id), account.id))
    throw new WorkflowError("This brand already has that destination connected", 409);
  update("accounts", account.id, { external_id: String(d.id), label: d.label, auth_enc: encrypt({ ...auth, ...d.extraAuth }) });
  logEvent("info", "account.destination", `${PLATFORMS[account.platform].name} ${d.label}`, { id: account.id });
  return { id: account.id, platform: account.platform, label: d.label };
}

/** Threads hands out a 1-hour token; swap it for the 60-day one (renewable while still valid). */
async function longLivedThreads(auth) {
  const q = new URLSearchParams({ grant_type: "th_exchange_token", client_secret: auth.client_secret, access_token: auth.access_token });
  const r = await fetch(`https://graph.threads.net/access_token?${q}`, { signal: AbortSignal.timeout(20000) }).then((x) => x.json()).catch(() => ({}));
  return r.access_token ? { ...auth, access_token: r.access_token, expires_at: Date.now() + (r.expires_in || 5184000) * 1000 } : auth;
}

async function longLivedMeta(auth) {
  const u = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  u.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: auth.client_id, client_secret: auth.client_secret, fb_exchange_token: auth.access_token });
  const r = await fetch(u,{signal:AbortSignal.timeout(20000)}).then((x) => x.json());
  return r.access_token ? { ...auth, access_token: r.access_token, expires_at: Date.now() + (r.expires_in || 5184000) * 1000 } : auth;
}

/** Non-OAuth accounts (Bluesky app password, Mastodon token, Telegram bot, Discord webhook). Validates by probing. */
export async function addManualAccount(brandId, platform, fields) {
  const P = META[platform];
  if (!P) throw new Error(`unknown platform ${platform}`);
  let label = fields.label || PLATFORMS[platform].name, external = null, legacy = null;
  const net = (e, what) => new Error(e?.friendly ? e.message : /fetch failed|ENOTFOUND|ECONN|timeout|abort/i.test(`${e?.message} ${e?.cause?.code}`) ? `Could not reach ${what}. Check the address and your internet connection.` : e.message);
  const bad = (m) => Object.assign(new Error(m), { friendly: true });
  try {
    if (platform === "bluesky") { const s = await P.mod.login(fields).catch((e) => { throw /401|Invalid identifier|AuthenticationRequired/i.test(e.message) ? bad("Bluesky rejected that handle or app password. Use an app password (Settings > Privacy and security > App passwords), not your main password.") : e; }); label = `@${s.handle}`; external = s.did; }
    if (platform === "mastodon") {
      let host; try { host = new URL(/^https?:\/\//.test(fields.instance) ? fields.instance : `https://${fields.instance}`); } catch { throw bad("That Mastodon server address is not valid. Use something like https://mastodon.social."); }
      const r = await fetchPublic(`${host.origin}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${fields.access_token}` } });
      if (r.status === 401 || r.status === 403) throw bad("The Mastodon server rejected that access token. Create a new one under Preferences > Development with write:statuses.");
      if (r.status !== 200) throw bad(`The Mastodon server answered ${r.status}. Check the server address.`);
      // Account ids are only unique per server, so the identity carries the origin.
      const me = JSON.parse(r.body); label = `@${me.username}@${host.host}`; external = `${host.origin}:${me.id}`; fields = { ...fields, instance: host.origin };
    }
    if (platform === "telegram") { const r = await fetch(`https://api.telegram.org/bot${encodeURIComponent(fields.bot_token)}/getMe`, { signal: AbortSignal.timeout(20000) }).then((x) => x.json()); if (!r.ok) throw bad("Telegram rejected that bot token. Copy it again from @BotFather."); 
      // "@channel" and "-100…" name the same chat; resolve to the numeric id so caps and reconnects see one identity.
      const c = await fetch(`https://api.telegram.org/bot${encodeURIComponent(fields.bot_token)}/getChat?chat_id=${encodeURIComponent(fields.chat_id)}`, { signal: AbortSignal.timeout(20000) }).then((x) => x.json());
      if (!c.ok) throw bad("Telegram cannot see that chat. Add the bot to the channel or group (as admin for channels) and check the chat id.");
      legacy = `${r.result.id}:${fields.chat_id}`; fields = { ...fields, chat_id: String(c.result.id) };
      label = `${r.result.username} \u2192 ${c.result.title || c.result.username || c.result.id}`; external = `${r.result.id}:${c.result.id}`; }
    if (platform === "discord") { let url; try { url = new URL(fields.webhook_url); } catch { throw bad("That is not a web address. Paste the full Discord webhook URL."); } if (url.protocol !== 'https:' || !['discord.com', 'discordapp.com'].includes(url.hostname) || !url.pathname.startsWith('/api/webhooks/')) throw bad('Use an HTTPS Discord webhook URL (https://discord.com/api/webhooks/\u2026).'); const r = await fetchPublic(url); if (r.status !== 200) throw bad("Discord rejected that webhook. It may have been deleted; create a new one."); const w = JSON.parse(r.body); label = `#${w.name}`; external = w.id; }
  } catch (e) { throw net(e, PLATFORMS[platform].name); }
  // Same remote account again under this brand: refresh it in place instead of adding a duplicate row.
  const known = external && one("SELECT id FROM accounts WHERE brand_id IS ? AND platform = ? AND external_id IN (?, ?)", brandId, platform, String(external), String(legacy ?? external));
  const id = known ? known.id : insert("accounts", { brand_id: brandId, platform, label, external_id: external, auth_enc: encrypt(fields) });
  if (known) update("accounts", id, { label, external_id: external, auth_enc: encrypt(fields), failures: 0, last_error: null, paused: 0, needs_reconnect: 0 });
  logEvent("info", "account.connected", `${PLATFORMS[platform].name} ${label}`, { id, brandId });
  return hydrate(one('SELECT * FROM accounts WHERE id=?',id));
}

// Mastodon identities used to be the bare account id, and the first migration kept the instance as typed
// (`https://x/:123`). Rewrite every row to `<instance origin>:<account id>`, the form connect() writes.
export function migrateMastodonIds() {
  for (const a of all("SELECT id, external_id, auth_enc FROM accounts WHERE platform = 'mastodon' AND external_id IS NOT NULL")) {
    try {
      const { instance } = decrypt(a.auth_enc), remote = a.external_id.slice(a.external_id.lastIndexOf(":") + 1); // ids are numeric; the origin may hold a port
      const canonical = instance && `${new URL(instance).origin}:${remote}`;
      if (canonical && canonical !== a.external_id) update("accounts", a.id, { external_id: canonical });
    } catch { /* unreadable row or bad instance: left for reconnect */ }
  }
}
migrateMastodonIds();
