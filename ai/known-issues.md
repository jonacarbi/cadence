# Known issues

| ID | Severity | Status | Summary |
|---|---|---|---|
| KI-001 | Medium | Resolved | 9Router/CatGPT/OGA are opt-in presets; default image provider is `openai` or `none` |
| KI-002 | Low | Open | History contains a local home path in commit 9b89de9 (docs text); no secrets found |
| KI-003 | Low | Resolved | CLI verified; docs now use `npm run setup/start/open/doctor` |
| KI-004 | Low | Open | Platform portal steps in `docs/CONNECT-ACCOUNTS.md` not checked against live portals |
| KI-005 | High | Resolved | Login link now carries a single-use 60 s ticket from `POST /auth/ticket`; the owner token never enters a URL |
| KI-006 | Medium | Resolved | UI says "run `cadence open`" but `cadence` is not on PATH after clone; correct form is `npm run open` |
| KI-007 | Medium | Resolved | `connect.js` now shows `callback_note` and the `tls` warning (B fixed it during round 2) |
| KI-008 | Medium | Open | Sessions are in memory: every restart or reboot signs the browser out |
| KI-009 | Medium | Open | Session cookie is host scoped, so other local servers on 127.0.0.1 receive it (logout is now POST + CSRF; Windows opener uses rundll32; schtasks "Access denied" gives an Administrator hint) |
| KI-010 | Medium | Resolved | Facebook, Instagram and Pinterest OAuth connect the first Page, linked Instagram account or board returned. Fixed: the account card has Change Page / Change account / Change board, which lists every destination of the same sign-in (`GET /api/accounts/:id/destinations`, no tokens returned) and switches the row in place (`PUT /api/accounts/:id/destination`) |

## KI-001
Observed: grep for 9Router and CatGPT. Impact: confuses public users. Action: Agent A to move to an optional legacy preset.

## KI-002
Observed: scan of `git log -p --all`. Impact: cosmetic. Action: owner decides whether to rewrite history before publishing; not rewritten.

## KI-005 to KI-009
Observed: code review plus live curl probes against a fresh clone. Detail and file:line are in the round 2 report. Owners: A for `server/bin` and `server/src/auth.js`, B for `server/web` and `web.js`.

## Resolved
Codex judge round 1 (2026-10-09, FAIL, 11 items) fixed the same day: brand codification runs only on Claude Code in full context with file tools (no Bash/web) and writes limited to its skill folder; non-Claude CLIs are never escalated; a 429 rests the whole remote account; caps count per remote identity across brands and manual reconnects update in place; `.env` inline comments parse (quoted values are literal); `npm run setup` finds or downloads a Chromium (`cadence browser`); image and Supabase settings apply live, so `/api/restart` is gone; `locked` is refused for gemini and opencode; an expired sign-in parks deliveries until reconnect; the webhook secret is write-only; docs say which secrets are AES-GCM (account tokens) and which sit in the 0600 `.env`.

Codex judge round 2 (2026-10-09, FAIL, 8 items) fixed the same day: `locked` beats per-run agentic tools and `runAgent` refuses locked gemini/opencode on every path; the design loop skips instead of running blind critics; agents never receive `OPENAI_API_KEY`/`OPENAI_IMAGE_*`; `.env` secrets and the webhook secret are sealed (`enc:v1:`) with `secret.key`, older plain values sealed on start; Mastodon identity = `origin:id` (migrated); Telegram resolves the chat with `getChat` and updates legacy `@name` rows in place; the browser polls `/oauth/status?state=` so reconnects finish.

Codex judge round 3 (2026-10-09, FAIL, 8 items) fixed the same day: agentic Claude runs load no settings (`--setting-sources ""`), run `dontAsk` with only Read/Write/Edit/Glob/Grep, and get path-scoped allow rules from `fileScope()` (codify: read brand + design-dna, write the skill folder; critics: read the brand folder), verified live to deny `.env` reads, outside writes, Grep and Bash; both `.env` files are sealed on start even when an environment override wins; the raw `POST /api/accounts` is gone; the Mastodon migration rewrites every row to `new URL(instance).origin:id`; Retry-After is kept up to a year; missed posts show in To review with a reschedule time; the live smoke test opens sealed values with the real folder's key and moves `deliveries.next_attempt_at` too.

Codex judge round 4 (2026-10-09, FAIL, 3 items) fixed the same day: `SECRET_PATHS` (config.js) lists every secret file and folder; Claude Code gets `--disallowedTools Read(...)` for each in every mode (deny beats any allow rule, verified live against an allow on the parent folder) and Codex runs a `default_permissions` profile with `:root` read and each secret path denied instead of `-s read-only` (verified live: canary read BLOCKED, write refused); the TOML uses literal strings so a Windows `.cmd` shim accepts it. The agentic test computes expected paths with `rulePath()` so Windows drive letters pass. The live smoke test calls `reloadEnvSettings()` after loading credentials and fails unless a generated (non-layout) image exists. Gemini CLI and opencode still have no per-path read deny (documented in SECURITY.md).

Codex judge round 5 (2026-10-09, FAIL, 2 items) fixed the same day: `frames`, `square` and `raw` are server-owned; create and edit drop them from client or agent input (`textAssets` in workflow.js), repurpose copies them from the source post, and the publisher's `ownMedia` (providers/registry.js) refuses any upload that is not an image under the assets or brands folder after realpath. Rescheduling a missed post queues only the accounts that never got it (`publishing`, `published` and `uncertain` deliveries are kept); when every account already has it the approve call returns 409.

Codex judge round 6 (2026-10-09, FAIL, 2 items) fixed the same day: the carousel renderer uses the post's generated image for every slide and ignores any `slides[].image` path from a draft. An action block or tripped breaker now pauses every account row with the same platform and `external_id`, so the same remote account connected under another brand stops too.

Codex judge round 7 (2026-10-10, PASS WITH FIXES, 4 MEDIUM): editing a post re-lints its captions so a fixed caption unlocks approval; Instagram media that fails processing before `media_publish` is marked definitely-not-sent and retryable; clearing a credential writes `KEY=` so an older repo-root `.env` value cannot return on restart. The destination picker (KI-010) was added afterwards.

KI-001, KI-003, KI-005, KI-006 (2026-10-09). Round-2 engine fixes the same day: agents run in an empty `agent-work` dir with Cadence secrets stripped from their env; Windows `findBin` skips the extensionless npm shim; data-folder `.env` wins over a repo `.env`; services persist `CADENCE_DIR` and `PORT`; `.env` writes are atomic; expired TLS certs regenerate.
