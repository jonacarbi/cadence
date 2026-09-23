// Pull per-platform metrics for recently published deliveries (at most hourly per delivery).
import { all, one, run, decrypt, getSetting } from './db.js';
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

// Every post in a plan used to land at the same fixed hour. Competitors guess a "best time" from
// global averages; this brand has its own receipts, so score the hours it actually published in.
const ENGAGEMENT = /^(likes?|favorites?|favourites?|comments?|replies|shares?|reposts?|retweets?|saves?|bookmarks?|reactions?|engagements?|clicks?)$/i;
const engagementOf = (metrics) => Object.entries(metrics || {}).reduce((sum, [k, v]) => (ENGAGEMENT.test(k) && Number.isFinite(v) ? sum + v : sum), 0);
const MIN_POSTS = 5; // Below this any "best hour" is noise dressed as data.

/** The hour of day this brand's own published posts performed best in, or the default when it has too few. */
export function recommendHour(brandId, fallback = 10, timeZone = getSetting('timezone', '') || Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const rows = all(
    `SELECT x.metrics_json, p.scheduled_at FROM analytics x JOIN posts p ON p.id = x.post_id
     WHERE p.brand_id = ? AND p.status = 'published' AND p.scheduled_at IS NOT NULL`, brandId);
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  const buckets = new Map();
  for (const r of rows) {
    const score = engagementOf(JSON.parse(r.metrics_json));
    if (!score) continue; // A post with no engagement numbers (or an unsupported platform) votes for nothing.
    const hour = Number(format.format(new Date(r.scheduled_at)));
    const b = buckets.get(hour) || { total: 0, posts: 0 };
    buckets.set(hour, { total: b.total + score, posts: b.posts + 1 });
  }
  const samples = [...buckets.values()].reduce((n, b) => n + b.posts, 0);
  if (samples < MIN_POSTS || buckets.size < 2) return { hour: fallback, basis: 'default', samples };
  const [hour] = [...buckets].sort((a, b) => b[1].total / b[1].posts - a[1].total / a[1].posts)[0];
  return { hour, basis: 'analytics', samples };
}
