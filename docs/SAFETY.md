# Safety: how Cadence tries to keep your accounts in good standing

No tool can promise an account will never be limited or banned. Platforms change their rules, and what you post matters more than how it is delivered. Cadence lowers the risk by behaving the way a careful person would, and by never doing the things platforms ban automation for.

## What Cadence never does

- Scrape, or log in with your password, or drive a browser to post. Publishing uses each platform's official API only.
- Follow, like, comment, DM or mass-engage. It publishes posts you approved.
- Retry an unclear send blindly. If the platform may or may not have accepted a post, it is marked **uncertain** for you to check, so you never get a duplicate.

## What it does by default

| Control | Default | Setting |
|---|---|---|
| Human approval of every post | on (autonomy: Review everything) | `autonomy`: `review_all`, `auto_trusted`, `hands_off` |
| Daily cap per account | per platform, below the platform limit (for example X 8, LinkedIn 3, Instagram 3, Reddit 2) | `cap_per_account_per_day` |
| Minimum gap between posts on one account | 90 minutes | `min_gap_minutes` |
| Random jitter added to scheduled times | up to 7 minutes | `jitter_minutes` |
| Warm-up for accounts under 14 days old | caps halved (minimum 1) | `warmup` |
| Backoff after a failure | honors Retry-After, else exponential from 1 minute | automatic |
| Failing lanes | circuit-break and pause instead of hammering | automatic |
| Identical text from several accounts of one platform | warning in the approval inbox | automatic |
| Posts the computer slept through | held for review when more than 6 hours late, instead of published late | `stale_after_hours` (0 = publish late anyway) |
| Expired or revoked sign-in | account marked "needs reconnect" and skipped until you reconnect | automatic |

Caps and spacing are enforced by the scheduler at send time, not only when you schedule.

These dials are under **Settings, Safety rails** in the web app and step 5 of the setup guide. Default caps per account per day: X 8, LinkedIn 3, Instagram 3, Facebook 4, Threads 6, Bluesky 10, Mastodon 8, Telegram 20, Discord 20, Pinterest 5, Reddit 2, TikTok 3.

## What stays your job

- Post things you would be comfortable posting by hand. Spam, misleading claims and repetitive content get accounts limited regardless of the tool.
- Read each platform's automation rules. Some require labelling automated accounts.
- Keep approval on until you trust the output for a brand. "Auto for trusted" and "Hands off" remove the human check.
- Do not run many accounts with near-identical content.

## Limits of this document

The default caps are conservative judgments, not figures published by the platforms. Live behavior on each platform is verified only with real connected accounts, which the maintainers have not done for every platform.
