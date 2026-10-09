// Tiny fetch helpers shared by providers.
import { AsyncLocalStorage } from "node:async_hooks";
/** registry.js runs each publish inside this store so a refreshed token is saved the moment it is issued —
 *  X rotates refresh tokens, so losing one because the publish itself then failed would disconnect the account. */
export const refreshContext = new AsyncLocalStorage();
const persist = (auth) => refreshContext.getStore()?.persist?.(auth);
// Kept in full: a platform asking for a multi-day rest means it, and retrying early is how accounts get flagged.
// The one-year ceiling only keeps a garbage header from becoming an unrepresentable date.
export const retryAfterMs = (res) => { const v = res.headers.get("retry-after"); if (!v) return 0; const s = Number(v); return Math.min(365 * 24 * 3600e3, Number.isFinite(s) ? Math.max(0, s * 1000) : Math.max(0, Date.parse(v) - Date.now()) || 0); };
export const mediaType = path => /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png';
export async function api(url, { method = "GET", headers = {}, json, body, form, timeout = 60_000 } = {}) {
  const h = { ...headers };
  let payload = body;
  if (json !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(json); }
  if (form) { const fd = new FormData(); for (const [k, v] of Object.entries(form)) fd.append(k, v); payload = fd; }
  const res = await fetch(url, { method, headers: h, body: payload, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`${new URL(url).host} ${res.status}: ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status; err.data = data; err.retryAfterMs = retryAfterMs(res);
    throw err;
  }
  return data;
}
export const bearer = (t) => ({ authorization: `Bearer ${t}` });

/** Mark a refresh failure the owner must fix by reconnecting (revoked/expired grant), as opposed to a network blip. */
export function refreshFailure(e, what = "The sign-in") {
  e.definitelyNotSent = true; // refresh happens before any publish call
  if ([400, 401, 403].includes(e.status)) { e.needsReconnect = true; e.message = `${what} expired or was revoked. Reconnect the account. (${e.message})`; }
  return e;
}

/** Refresh an OAuth2 token if `expires_at` has passed. Returns possibly-updated auth (already persisted). */
export async function refreshIfNeeded(auth, tokenUrl, extra = {}) {
  if (!auth.expires_at || Date.now() < auth.expires_at - 60_000) return auth;
  if (!auth.refresh_token) { const e = new Error("The sign-in expired and cannot be renewed automatically. Reconnect the account."); e.needsReconnect = e.definitelyNotSent = true; throw e; }
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refresh_token, ...extra });
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (auth.client_id && auth.client_secret && !extra.client_id && !extra.client_key) headers.authorization = "Basic " + Buffer.from(`${auth.client_id}:${auth.client_secret}`).toString("base64");
  let t;
  try { t = await api(tokenUrl, { method: "POST", headers, body: params.toString() }); } catch (e) { throw refreshFailure(e); }
  if (!t.access_token) { const e = new Error("Token refresh returned no access token. Reconnect the account."); e.needsReconnect = e.definitelyNotSent = true; throw e; }
  const fresh = { ...auth, access_token: t.access_token, refresh_token: t.refresh_token || auth.refresh_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000, _updated: true };
  persist(fresh);
  return fresh;
}

/** Meta long-lived tokens (Instagram, Threads) last ~60 days and renew only while still valid. Refresh inside the last week. */
export async function refreshMetaToken(auth, kind) {
  if (!auth.expires_at || Date.now() < auth.expires_at - 7 * 86400e3) return auth;
  if (Date.now() >= auth.expires_at) { const e = new Error("The sign-in expired. Reconnect the account."); e.needsReconnect = e.definitelyNotSent = true; throw e; }
  const u = kind === "threads"
    ? `https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: auth.access_token })}`
    : `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: auth.client_id, client_secret: auth.client_secret, fb_exchange_token: auth.access_token })}`;
  let t; try { t = await api(u); } catch (e) { throw refreshFailure(e); }
  if (!t.access_token) return auth;
  const fresh = { ...auth, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 5184000) * 1000, _updated: true };
  persist(fresh);
  return fresh;
}
