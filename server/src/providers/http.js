// Tiny fetch helpers shared by providers.
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
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
export const bearer = (t) => ({ authorization: `Bearer ${t}` });

/** Refresh an OAuth2 token if `expires_at` has passed. Returns possibly-updated auth. */
export async function refreshIfNeeded(auth, tokenUrl, extra = {}) {
  if (!auth.refresh_token || !auth.expires_at || Date.now() < auth.expires_at - 60_000) return auth;
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refresh_token, ...extra });
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (auth.client_id && auth.client_secret && !extra.client_id && !extra.client_key) headers.authorization = "Basic " + Buffer.from(`${auth.client_id}:${auth.client_secret}`).toString("base64");
  const t = await api(tokenUrl, { method: "POST", headers, body: params.toString() });
  return { ...auth, access_token: t.access_token, refresh_token: t.refresh_token || auth.refresh_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000, _updated: true };
}
