// Publishing safety: conservative per-platform daily caps, a minimum gap between posts on one account, scheduling jitter,
// warm-up for brand-new accounts and Retry-After backoff. Official APIs only; this keeps accounts looking like a person's.
import { all, getSetting, setSetting } from './db.js';

/** Posts per account per day when the owner has not set a cap. Deliberately below each platform's hard limit. */
export const DEFAULT_CAPS = { x: 8, linkedin: 3, instagram: 3, facebook: 4, threads: 6, bluesky: 10, mastodon: 8, telegram: 20, discord: 20, pinterest: 5, reddit: 2, tiktok: 3 };
export const WARMUP_DAYS = 14, DEFAULT_GAP_MIN = 90, DEFAULT_JITTER_MIN = 7;
const DRY_RUN = new Set(['mock']);
const num = (key, fallback) => { const v = getSetting(key, ''); return v === '' || v === null || !Number.isFinite(Number(v)) ? fallback : Number(v); };
const flag = (key, fallback) => { const v = getSetting(key, ''); return v === '' || v === null ? fallback : v === true || v === 'true' || v === 1 || v === '1' || v === 'on'; };

export const settings = () => ({ cap: num('cap_per_account_per_day', 0), gap: num('min_gap_minutes', DEFAULT_GAP_MIN), jitter: num('jitter_minutes', DEFAULT_JITTER_MIN), warmup: flag('warmup', true) });

/** Daily cap for one account: the owner's number, else the platform default; halved (min 1) while the account is under 14 days old. */
export function dailyCap(account, cfg = settings(), nowMs = Date.now()) {
  if (DRY_RUN.has(account.platform)) return Infinity;
  const base = cfg.cap > 0 ? cfg.cap : DEFAULT_CAPS[account.platform] ?? 5;
  const created = Date.parse(String(account.created_at).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(account.created_at) ? '' : 'Z'));
  const young = cfg.warmup && Number.isFinite(created) && nowMs - created < WARMUP_DAYS * 86400e3;
  return young ? Math.max(1, Math.floor(base / 2)) : base;
}

/** Random delay in ms within [0, minutes], never negative: callers add it to a time that is already allowed. */
export const jitterMs = (minutes = settings().jitter, rand = Math.random) => Math.max(0, Math.floor(rand() * Math.max(0, minutes) * 60_000));

const dayKey = (tz) => { const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone }); return (d) => f.format(new Date(d)); };

/** One remote account can be connected under several brands (or twice by hand): limits follow the remote identity, not the row. */
export const identityKey = (account) => `${account.platform}:${account.external_id || account.id}`;
const cooldownKey = (account) => `cooldown:${identityKey(account)}`;
/** After a 429 the whole remote account rests until Retry-After, not just the delivery that hit it. */
export const startCooldown = (account, untilMs) => setSetting(cooldownKey(account), new Date(untilMs).toISOString());

/** True when this account may publish now: not cooling down, under today's cap and past the minimum gap since its last send. */
export function accountMayPublish(account, nowMs = Date.now(), cfg = settings()) {
  if (DRY_RUN.has(account.platform)) return true;
  if (Date.parse(getSetting(cooldownKey(account), '') || '') > nowMs) return false;
  const recent = all("SELECT started_at FROM deliveries WHERE account_id IN (SELECT id FROM accounts WHERE platform=? AND (id=? OR (external_id IS NOT NULL AND external_id=?))) AND status IN ('published','sending','uncertain') AND started_at>=?", account.platform, account.id, account.external_id ?? null, new Date(nowMs - 48 * 3600e3).toISOString());
  const key = dayKey(getSetting('timezone') || ''), today = key(nowMs);
  if (recent.filter((d) => key(d.started_at) === today).length >= dailyCap(account, cfg, nowMs)) return false;
  const last = Math.max(0, ...recent.map((d) => Date.parse(d.started_at)));
  return !(cfg.gap > 0 && last && nowMs - last < cfg.gap * 60_000);
}

/** Delay before retrying after a failure: the platform's Retry-After when given, else exponential from one minute. */
export const backoffMs = (attempts, retryAfterMs = 0) => Math.max(retryAfterMs || 0, 60_000 * 2 ** Math.min(attempts, 10));

/** Warnings (never blockers) for text that would go out identically from 2+ accounts of one platform. Platforms treat that as coordinated spam. */
export function duplicateTextWarnings(post, accounts) {
  const out = [];
  for (const platform of new Set(accounts.map((a) => a.platform))) {
    const same = accounts.filter((a) => a.platform === platform);
    if (same.length > 1 && post.copy?.[platform]) out.push(`${same.length} ${platform} accounts would post identical text. Vary the wording per account, or pick one account, to avoid being flagged as spam.`);
  }
  return out;
}
