// Progressive autonomy dial (owner-only). review_all: humans approve everything. auto_trusted: drafts that pass
// lint auto-approve and schedule to accounts marked trusted. hands_off: same, for every connected account.
import { all, one, hydrate, getSetting, setSetting, logEvent } from './db.js';
import { approvePost, schedulePost, WorkflowError } from './workflow.js';

export const LEVELS = ['review_all', 'auto_trusted', 'hands_off'];
export const autonomy = () => getSetting('autonomy', 'review_all');
export function setAutonomy(level) {
  if (!LEVELS.includes(level)) throw new WorkflowError('Autonomy must be review_all, auto_trusted or hands_off');
  setSetting('autonomy', level);
  logEvent('warn', 'autonomy.changed', `Autonomy set to ${level}`);
  return level;
}

/** Called each scheduler tick. Returns the number of posts auto-scheduled. */
export function autoApproveDue() {
  const level = autonomy();
  if (level === 'review_all') return 0;
  let n = 0;
  for (const post of all("SELECT * FROM posts WHERE status = 'draft' AND (image_path IS NOT NULL OR format = 'text')").map(hydrate)) {
    if(post.campaign_id && one("SELECT id FROM agent_requests WHERE campaign_id=? AND status NOT IN ('review','scheduled')",post.campaign_id))continue;
    const accounts = post.platforms.flatMap((p) => all('SELECT * FROM accounts WHERE brand_id = ? AND platform = ? AND paused = 0', post.brand_id, p));
    if (!accounts.length || post.platforms.some((p) => !accounts.some((a) => a.platform === p))) continue;
    if (level === 'auto_trusted' && !accounts.every((a) => a.trusted)) continue;
    if (Date.parse(post.scheduled_at) <= Date.now()) continue;
    try {
      const approved = approvePost(post.id, post.version, `autonomy:${level}`);
      schedulePost(post.id, approved.version, accounts.map((a) => a.id));
      logEvent('info', 'post.autoapproved', `Auto-approved and scheduled "${post.topic}" (${level})`, { id: post.id });
      n++;
    } catch (e) { logEvent('warn', 'post.autoapprove', `${post.topic}: ${e.message}`, { id: post.id }); }
  }
  return n;
}
