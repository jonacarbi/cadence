// Outbound notifications for n8n / Zapier / Make: one URL, JSON POST, HMAC signature when a secret is set.
import { createHmac } from 'node:crypto';
import { getSetting, logEvent } from './db.js';
import { publicURL } from './network.js';

export async function notify(kind, data) {
  const url = getSetting('webhook_url', '');
  if (!url) return;
  const body = JSON.stringify({ kind, at: new Date().toISOString(), data });
  const headers = { 'content-type': 'application/json' };
  const secret = getSetting('webhook_secret', '');
  if (secret) headers['x-cadence-signature'] = createHmac('sha256', secret).update(body).digest('hex');
  try {
    await publicURL(url);
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) { logEvent('warn', 'webhook.failed', `${kind}: ${e.message}`); }
}
