// Public media hosting for platforms that need a URL (Instagram, Threads, Reddit).
// Supabase Storage when configured; otherwise fail loudly with a clear message.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET } from "./config.js";

export const canHost = () => Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

export async function hostPublic(path) {
  if (!canHost()) throw new Error("Public media hosting not configured: set SUPABASE_URL + SUPABASE_SERVICE_KEY (needed for Instagram/Threads/Reddit)");
  const key = `${Date.now()}-${basename(path)}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: "POST", headers: { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "content-type": "image/png", "x-upsert": "true" },
    body: readFileSync(path),
  });
  if (res.status === 404 || res.status === 400) {
    // bucket may not exist yet — create it public and retry once
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: "POST", headers: { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: true }) });
    return hostPublic(path);
  }
  if (!res.ok) throw new Error(`supabase upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${key}`;
}
