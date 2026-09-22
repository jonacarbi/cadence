// Public media hosting for platforms that need a URL (Instagram, Threads, Reddit).
// Supabase Storage when configured; otherwise fail loudly with a clear message.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET } from "./config.js";
import { mediaType } from './providers/http.js';

export const canHost = () => Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

export async function hostPublic(path, { createBucket = true } = {}) {
  if (!canHost()) throw new Error("Public media hosting not configured: set SUPABASE_URL + SUPABASE_SERVICE_KEY (needed for Instagram/Threads/Reddit)");
  const key = `${Date.now()}-${basename(path)}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: "POST", headers: { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "content-type": mediaType(path), "x-upsert": "true" },
    body: readFileSync(path),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404 && createBucket) {
    // bucket may not exist yet — create it public and retry once
    const bucket=await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: "POST", headers: { authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: true }),signal:AbortSignal.timeout(15000) });
    if(!bucket.ok&&bucket.status!==409)throw new Error(`Supabase bucket creation failed (${bucket.status})`);
    return hostPublic(path,{createBucket:false});
  }
  if (!res.ok) throw new Error(`supabase upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${key}`;
}
