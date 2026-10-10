# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - Unreleased

### Added
- Bring your own agent: Claude Code, Codex, Gemini, opencode or any OpenAI-compatible endpoint, switchable in Settings.
- Cross-platform install for macOS, Linux and Windows, with a CLI (`start`, `open`, `doctor`, `service install|uninstall|status`, `mcp`, `token`) and npm scripts `setup`, `start`, `open`, `doctor`, `test`.
- Browser interface served by the local server, signed in through `npm run open`.
- Automatic self-signed certificate for the https sign-in callback (Instagram, Facebook, Threads, TikTok), with per-OS trust steps in `docs/CONNECT-ACCOUNTS.md`.
- Guided account connection with per-platform setup steps and exact redirect URIs.
- Destination picker for Facebook Pages, Instagram accounts and Pinterest boards: connect once, then choose where the account posts from its card.
- Safety settings: jitter, minimum gap between posts and account warm-up. A rate-limit (429) pauses the whole remote account, and caps follow the remote account even when it is connected under several brands.
- `cadence browser` (run by `npm run setup`) reuses Chrome, Edge or Chromium, or downloads Playwright's Chromium.
- Open-source project files, CI on Linux, macOS and Windows, brand assets and a landing page.

### Changed

- Editing a caption re-checks it, so fixing a blocking issue unlocks approval.
- Instagram media that fails processing is retried instead of being marked uncertain.
- Clearing a credential stays cleared after a restart.
- Drafts can no longer name the files the publisher uploads: generated media paths are server-owned, and every upload must be an image inside Cadence's media folders.
- Rescheduling a partly published post only re-queues the accounts that never got it.
- Carousel slides always use the post's generated image; a draft cannot point a slide at a local file.
- When a platform blocks an account, every brand connected to that same account pauses, not just the one that hit the block.
- Claude Code and Codex can no longer read Cadence's own secrets (key, tokens, settings file, database, backups, TLS key) in any mode; Codex runs in a read-only permission profile instead of `-s read-only`.
- API keys, app client secrets and the webhook secret are AES-256-GCM sealed in `.env` / settings; plain values are sealed on start.
- Locked agent context always wins (no per-run tool escalation); the design loop is skipped when the agent cannot read images.
- Mastodon identities include the server; Telegram chats resolve to their numeric id, so caps and reconnects see one account.
- OAuth sign-in in the browser reports its own outcome, so reconnecting an existing account no longer times out.
- Saved keys apply without a restart; the restart endpoint and the Mac app's restart banner are gone.
- The webhook signing secret is write-only over the API.
- Brand codification (design-dna) and the design-loop critics run only on Claude Code, with no shell, no web and no user settings: they can read only the brand (and design-dna) folder and write only the new skill folder.
- A missed post shows in the inbox's To review tab with a "Publish at" time; a new time plus approval schedules a fresh delivery.
- Retry-After is honoured in full (up to a year), and LinkedIn's date-form header is understood.
- Removed the raw `POST /api/accounts`; accounts come only from sign-in or `/api/accounts/manual`, which resolve the canonical remote id.
- Documentation rewritten for public use; see `docs/CONNECT-ACCOUNTS.md` and `docs/SAFETY.md`.

## [0.2.0]

Local macOS release: Content agent, brand onboarding, monthly planning, atomic approval and scheduling. See `docs/RELEASE-0.2.0.md`.
