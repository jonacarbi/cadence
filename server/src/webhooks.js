// Outbound notifications for n8n / Zapier / Make: one URL, JSON POST, HMAC signature when a secret is set.
import { createHmac } from 'node:crypto';
import { getSetting, setSetting, logEvent } from './db.js';
import { sealEnvValue, openEnvValue, SEALED } from './config.js';
import { fetchPublic } from './network.js';

export async function notify(kind, data) {
  const url = getSetting('webhook_url', '');
  if (!url) return;
  const body = JSON.stringify({ kind, at: new Date().toISOString(), data });
  const headers = { 'content-type': 'application/json' };
  const secret = openEnvValue(getSetting('webhook_secret', ''));
  if (secret) headers['x-cadence-signature'] = createHmac('sha256', secret).update(body).digest('hex');
  try {
    const res = await fetchPublic(url, { method: 'POST', headers, body, timeout:10_000 });
    if (res.status<200||res.status>=300) throw new Error(`HTTP ${res.status}`);
  } catch (e) { logEvent('warn', 'webhook.failed', `${kind}: ${e.message}`); }
}

/** The HMAC secret is stored sealed like every other credential; older installs saved it plain. */
export const saveWebhookSecret = (v) => setSetting('webhook_secret', v ? sealEnvValue(v) : '');
export function sealWebhookSecret() { const v = getSetting('webhook_secret', ''); if (v && !v.startsWith(SEALED)) saveWebhookSecret(v); }
