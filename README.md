# Cadence

Local-first macOS social media agent. Paste a client's website, get a codified design system, a month of on-brand posts with OpenAI imagery, an approval inbox, and hands-off publishing at the right time.

## What it does

1. **Brand from URL** — extracts the site's design system (design-dna), checks design memory (`~/.claude/skills/<slug>` + local brands), codifies it, then runs the **design loop** gauntlet: three fresh critics (brief / system / craft) judge a rendered hero until it passes a bar torn down from the client's own site.
2. **Plan a month** — pillars, cadence, per-platform copy, lint against `server/rules.json`, OpenAI images (direct key or CatGPT gateway), Playwright-rendered layouts (editorial / carousel / square).
3. **Approve** — every post lands in the inbox with preview, per-platform copy, lint, comments, *Regenerate from feedback*, *New visual*. Approve & schedule in one click.
4. **Publish** — scheduler claims deliveries atomically, honours per-account caps, circuit-breaks failing lanes, marks ambiguous sends *uncertain* (never blind-retries), collects analytics hourly, fires signed webhooks.
5. **Autonomy dial** — *Review everything* · *Auto for trusted* · *Hands off*.
6. **MCP** — `node server/src/mcp.js` exposes 20 tools so Claude Code / Codex can plan, comment, and (as owner) approve.

Destinations: Instagram, Facebook, LinkedIn, X, Threads, Bluesky, Mastodon, Pinterest, Reddit, Telegram, Discord.

## Run

```bash
cp .env.example .env            # fill in OpenAI / CatGPT / 9Router
npm ci --prefix server && npm test --prefix server
scripts/build-macos.sh          # → build/Cadence.app (bundles node + server)
open build/Cadence.app
```

Always-on publishing without the window open: `launchctl load ~/Library/LaunchAgents/com.jonacarbi.cadence.plist` (runs `scripts/run.sh`). The app attaches to whichever service owns `127.0.0.1:8796`.

## Security model

Loopback only, bearer owner/agent tokens (0600 files in `~/Library/Application Support/Cadence`), Origin rejected, Host pinned. Agent role can draft and comment but never approve. Credentials AES-256-GCM at rest. SSRF guard on every outbound URL. Edits bump version and clear approval; stale deliveries can't execute.

## Layout

- `server/src` — API (`api.js`, `routes-extra.js`), workflow, scheduler, brands/design loop, campaigns, visuals, providers, MCP.
- `mac/` — SwiftUI app (SwiftPM, macOS 14+).
- `docs/COMPETITOR-RESEARCH.md` — feature ledger vs trypost, Postiz, PendPost, LangChain social agent.
