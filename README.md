# Cadence

Local-first macOS social media agent. Paste a client's website, get a saved design system, platform-specific content, a month on the calendar, and publishing through connected accounts. Cadence 0.2.0 is a local macOS release; public distribution still requires Developer ID signing and notarization.

## Content agent

Open **Content agent** in the sidebar. Paste a website or write a brief. Choose an existing brand or enable **Create a new brand**.

- **Brand identity** creates a name, palette, typography, audience, voice and content pillars from a brief, or extracts the website’s identity.
- **One post per channel** generates copy for every active account platform on that brand, with branded visuals.
- **A whole month** creates one daily post per platform. Choose the month, local posting hour and timezone; past dates in the current month are skipped. A single post keeps its exact chosen timestamp.
- Review the generated posts, edit individual platform captions, then **Approve and schedule all**. Existing autonomy settings can also approve and schedule ready content.
- **Plan the next month automatically** (Settings) replans each new month from the last month's brief, platforms, count and hour. Drafts still land in the approval inbox.
- If no accounts are connected, the brand is saved and the request waits. Connect accounts and press **Continue**. Failed/interrupted work can resume; completed planning batches and cached images are reused.

Requests, brand context, campaign dates and jobs are saved in SQLite. Each campaign pins its design-system snapshot. Draft creation and batch scheduling are atomic; a missing destination cannot leave half a month approved or scheduled.

## AI configuration

The configured production path is **9Router `cx/gpt-5.6-terra` for text** and **Open Generative AI MCP → CatGPT for images**. Cadence calls the MCP `generate_image` tool over stdio and pins `catgpt-gateway`. It does not fall through to a different image provider. CatGPT exposes the `chatgpt` alias; the browser service controls its underlying image-model version.

Configuration lives in `~/Library/Application Support/Cadence/.env` (or repo `.env` for development). See `.env.example`. `CADENCE_OGA_MCP_ENTRY` points to your installed MCP server's `src/index.js`. Keep 9Router and CatGPT running and signed in. Settings shows configuration readiness. Generated assets render in headless Chrome/Chromium; installed Google Chrome is used if Playwright’s matching browser is absent.

## What it does

1. **Brand from URL** — extracts the site's design system (design-dna), checks design memory (`~/.claude/skills/<slug>` + local brands), codifies it, then runs the **design loop** gauntlet: three fresh critics (brief / system / craft) judge a rendered hero until it passes a bar torn down from the client's own site.
2. **Plan a month** — pillars, cadence, per-platform copy, lint against `server/rules.json`, CatGPT images through Open Generative AI MCP, Playwright-rendered layouts (editorial / carousel / square).
3. **Approve** — every post lands in the inbox with preview, per-platform copy, lint, comments, *Regenerate from feedback*, *New visual*. Approve & schedule in one click.
4. **Publish** — scheduler claims deliveries atomically, honours per-account caps, circuit-breaks failing lanes, marks ambiguous sends *uncertain* (never blind-retries), collects analytics hourly, fires signed webhooks.
5. **Autonomy dial** — *Review everything* · *Auto for trusted* · *Hands off*.
6. **MCP** — `node server/src/mcp.js` exposes tools so Claude Code / Codex can plan, comment, and (as owner) approve.

Publishing adapters: Instagram, Facebook, LinkedIn, X, Threads, Bluesky, Mastodon, Pinterest, Telegram and Discord. Mock accounts are dry runs. TikTok/YouTube have no publishing adapters and are disabled; Reddit is not registered. Live OAuth platforms need their developer-app credentials; Instagram/Threads/Pinterest image publishing needs public media hosting. Live platform publishing must be verified with real connected accounts.

## Run

```bash
cp .env.example .env            # fill in OpenAI / CatGPT / 9Router
npm ci --prefix server && npm test --prefix server
scripts/build-macos.sh          # → build/Cadence.app (bundles node + server)
open build/Cadence.app
```

Always-on publishing without the window open: `launchctl load ~/Library/LaunchAgents/com.jonacarbi.cadence.plist` (runs `scripts/run.sh`). The app attaches to whichever service owns `127.0.0.1:8796`.

## Security model

Loopback only, bearer owner/agent tokens (0600 files in `~/Library/Application Support/Cadence`), Origin rejected, Host pinned. Agent role can draft and comment but never approve. Credentials AES-256-GCM at rest. Website imports, source fetches, caption links and webhooks use validated, DNS-pinned public-only requests. Asset reads reject path traversal and escaping symlinks. Edits bump version and clear approval; stale deliveries can't execute.

## Verification

```bash
npm test --prefix server
swift build --package-path mac -c release
CADENCE_LIVE_SMOKE=1 node scripts/smoke-agent.mjs
```

The opt-in smoke test generates one real image and text with the configured providers in an isolated temporary workspace. Delivery uses mock adapters only. Its report and rendered sample are saved in `build/release-check/`. It never publishes to real social accounts. `CADENCE_SMOKE_RESUME` can resume the printed temporary workspace.

Release details and remaining setup: [docs/RELEASE-0.2.0.md](docs/RELEASE-0.2.0.md).

## Layout

- `server/src` — API (`api.js`, `routes-extra.js`), workflow, scheduler, brands/design loop, campaigns, visuals, providers, MCP.
- `mac/` — SwiftUI app (SwiftPM, macOS 14+).
- `docs/COMPETITOR-RESEARCH.md` — feature ledger vs trypost, Postiz, PendPost, LangChain social agent.
