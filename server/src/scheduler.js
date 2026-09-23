import { all, one, run, update, decrypt, hydrate, now, getSetting } from "./db.js";
import { transaction } from "./workflow.js";
import { providerFor } from "./providers/index.js";
import { lintCaption, hasBlockers } from "./lint.js";
import { MAX_ATTEMPTS, BREAKER_THRESHOLD, TICK_MS } from "./config.js";
import { autoApproveDue } from "./autonomy.js";
import { collectAnalytics } from "./analytics.js";
import { notify } from "./webhooks.js";
import { rollMonthlyCampaigns } from "./campaigns.js";
import { scanSources } from "./sources.js";
// A process dying after a remote send is ambiguous. Require reconciliation rather than blind retry.

export function recoverInterruptedDeliveries() {
  transaction(() => {
    run(
      "UPDATE deliveries SET status = 'uncertain', error = 'Publisher interrupted; check the remote account before retrying' WHERE status = 'sending'",
    );
    run("UPDATE posts SET status = 'uncertain' WHERE status = 'publishing'");
  });
}

function claim() {
  return transaction(() => {
    const candidates = all(
      `SELECT d.* FROM deliveries d JOIN posts p ON p.id = d.post_id JOIN accounts a ON a.id = d.account_id WHERE d.status IN ('queued','retry') AND p.status IN ('scheduled','publishing') AND p.approved_by IS NOT NULL AND p.version = d.version AND a.paused = 0 AND p.scheduled_at <= ? AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?) ORDER BY p.scheduled_at`,
      now(),
      now(),
    );
    const cap=Number(getSetting('cap_per_account_per_day',''));
    const format=new Intl.DateTimeFormat('en-CA',{timeZone:getSetting('timezone')||Intl.DateTimeFormat().resolvedOptions().timeZone});
    const today=format.format(new Date());
    const row=candidates.find(candidate=> !cap || all("SELECT started_at FROM deliveries WHERE account_id=? AND status IN ('published','sending','uncertain') AND started_at>=?",candidate.account_id,new Date(Date.now()-48*3600e3).toISOString()).filter(d=>format.format(new Date(d.started_at))===today).length<cap);
    if (!row) return null;
    run("UPDATE deliveries SET status = 'sending', attempts = attempts + 1, started_at = ? WHERE id = ?", now(), row.id);
    update("posts", row.post_id, { status: "publishing" });
    return one("SELECT * FROM deliveries WHERE id = ?", row.id);
  });
}

function summarize(postId) {
  const post = one("SELECT version FROM posts WHERE id = ?", postId);
  const rows = all("SELECT status FROM deliveries WHERE post_id = ? AND version = ?", postId, post.version);
  const states = rows.map((r) => r.status);
  const status = states.every((s) => s === "published")
    ? "published"
    : states.includes("uncertain")
      ? "uncertain"
      : states.some((s) => ["queued", "retry", "sending"].includes(s))
        ? "scheduled"
        : "failed";
  update("posts", postId, { status });
}

export async function tick({ getProvider = providerFor, max = 20 } = {}) {
  autoApproveDue();
  for (let i = 0; i < max; i++) {
    const delivery = claim();
    if (!delivery) break;
    const post = hydrate(one("SELECT * FROM posts WHERE id = ?", delivery.post_id));
    const account = one("SELECT * FROM accounts WHERE id = ?", delivery.account_id);
    let sent = false;
    try {
      const issues = lintCaption(post.copy[account.platform], account.platform);
      if (hasBlockers(issues)) throw new Error("Caption no longer passes publishing rules");
      const provider = getProvider(account.platform);
      const auth = decrypt(account.auth_enc);
      await provider.validate?.({ post, account, auth });
      sent = true;
      const result = await provider.publish({ post, account, auth, idempotencyKey: delivery.id });
      if (!result?.id) throw new Error("Provider returned no publication receipt");
      transaction(() => {
        update("deliveries", delivery.id, {
          status: "published",
          remote_id: String(result.id),
          remote_url: result.url || null,
          finished_at: now(),
          error: null,
        });
        update("accounts", account.id, { failures: 0, last_error: null });
        summarize(post.id);
      });
      void notify('post.published', { post_id: post.id, topic: post.topic, platform: account.platform, url: result.url || null });
    } catch (error) {
      // Providers may declare a rejection definitely not sent. Network timeouts never qualify.
      const ambiguous = sent && !error.definitelyNotSent;
      const retry = !ambiguous && error.retryable && delivery.attempts < MAX_ATTEMPTS;
      const failures = account.failures + 1;
      transaction(() => {
        update("deliveries", delivery.id, {
          status: ambiguous ? "uncertain" : retry ? "retry" : "failed",
          error: String(error.message).slice(0, 1000),
          next_attempt_at: retry ? new Date(Date.now() + 60_000 * 2 ** delivery.attempts).toISOString() : null,
        });
        update("accounts", account.id, {
          failures,
          last_error: String(error.message).slice(0, 1000),
          paused: error.actionBlocked || failures >= BREAKER_THRESHOLD ? 1 : account.paused,
        });
        summarize(post.id);
      });
    }
  }
}

export function startScheduler() {
  recoverInterruptedDeliveries();
  let busy = false;
  const invoke = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick();
      await collectAnalytics();
      rollMonthlyCampaigns();
      await scanSources();
    } catch (e) {
      console.error("Scheduler:", e.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(invoke, TICK_MS);
  timer.unref();
  void invoke();
  return () => clearInterval(timer);
}
