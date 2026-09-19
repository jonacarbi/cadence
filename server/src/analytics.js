// Pull per-platform metrics for recently published deliveries (at most hourly per delivery).
import { all, one, run, decrypt } from './db.js';
import { providerFor } from './providers/index.js';

export async function collectAnalytics(limit = 5) {
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString();
  const stale = new Date(Date.now() - 3600e3).toISOString();
  const rows = all(`SELECT d.*, a.platform, a.auth_enc FROM deliveries d JOIN accounts a ON a.id = d.account_id
    WHERE d.status = 'published' AND d.finished_at >= ? AND NOT EXISTS (SELECT 1 FROM analytics x WHERE x.post_id = d.post_id AND x.platform = a.platform AND x.fetched_at > ?) LIMIT ?`, cutoff, stale, limit);
  for (const d of rows) {
    let metrics;
    try { const p = providerFor(d.platform); metrics = p.metrics ? await p.metrics(decrypt(d.auth_enc), { id: d.remote_id, url: d.remote_url, account: d.account_id }) : { unsupported: true }; }
    catch (e) { metrics = { error: e.message }; }
    run("INSERT OR REPLACE INTO analytics (post_id, platform, fetched_at, metrics_json) VALUES (?,?,datetime('now'),?)", d.post_id, d.platform, JSON.stringify(metrics || {}));
  }
  return rows.length;
}
export const analyticsFor = (brandId) => all('SELECT x.post_id, x.platform, x.fetched_at, x.metrics_json, p.topic, p.scheduled_at FROM analytics x JOIN posts p ON p.id = x.post_id WHERE p.brand_id = ? ORDER BY p.scheduled_at DESC', brandId).map((r) => ({ ...r, metrics: JSON.parse(r.metrics_json), metrics_json: undefined }));
