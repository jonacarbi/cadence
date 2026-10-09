// One fetch wrapper. Same-origin cookie session + the CSRF header the server requires on every write.
export class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Cadence-CSRF': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiError('Cannot reach the Cadence service. Is it running?', 0); }
  if (res.status === 401) { window.dispatchEvent(new Event('cadence:signed-out')); throw new ApiError('Your session ended. Run `npm run open` in the Cadence folder to sign in again.', 401); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}
export const get = (p) => api(p);
export const send = (method, p, body = {}) => api(p, { method, body });
/** Optional endpoints (another release may not have them yet): resolves to null on 404 instead of throwing. */
export const maybe = (p) => api(p).catch((e) => { if (e.status === 404) return null; throw e; });
