# Project state

Updated 2026-10-09 (D-006).

Phase: open-source release prep, not yet pushed to GitHub. Landing page live at https://cadence-social-agent.netlify.app

| Item | Evidence |
|---|---|
| Brand assets (mark, logo, favicon, OG, icons) | OBSERVED `brand/`, rendered and viewed |
| App icon wired into the Mac build | OBSERVED `mac/Resources/AppIcon.icns`, `scripts/build-macos.sh` (copy plus CFBundleIconFile). Full bundle build not run by Agent C |
| Landing page deployed | OBSERVED HTTP 200 and security headers via `curl -I`, 2026-10-09 |
| Screenshots at 390 and 1440, light and dark | OBSERVED `docs/site-screens/`, no horizontal overflow at 320, 390, 1440 |
| README, LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG | OBSERVED repo root |
| CI, issue forms, PR template, dependabot | OBSERVED `.github/`. Workflow not run yet (no GitHub remote) |
| Docs: CONNECT-ACCOUNTS, SAFETY | OBSERVED `docs/`. Platform portal details are from general knowledge, UNKNOWN against current portals |
| History and tree secret scan | OBSERVED clean for keys and tokens; see `known-issues.md` KI-002 |
| CLI `server/bin/cadence.mjs` (start, open, doctor, service, mcp, token) | OBSERVED read and run from a fresh clone in a scratch dir: `npm run setup`, `doctor`, `start`, `/health`, cookie login, 403 on foreign Host and Origin |
| Service install on launchd, systemd, Task Scheduler | INFERRED from `service.mjs` builders; not installed on this machine, Linux and Windows not run |
| Redirect policy (http 127.0.0.1:PORT for X, LinkedIn, Pinterest, Reddit; https localhost:PORT+1 for Instagram, Facebook, Threads, TikTok) | OBSERVED from `GET /api/platforms/setup` on a fresh server |
| Server test suite | OBSERVED 77 of 77 passing per the coordinator, 2026-10-09 |
| Browser auth red-team (Agent C round 2) | OBSERVED live probes plus code review; findings handed to Agents A and B, see `known-issues.md` KI-005 to KI-009 |

## Next

1. Fix KI-005 to KI-009 (owners A and B), then re-run the red-team probes.
2. Real app screenshots are in `docs/screenshots/` (Agent B).
3. Create the GitHub repo `jonacarbi/cadence`, push, confirm CI on all three OS.
4. Developer ID signing and notarization (`scripts/release-macos.sh`).

## Blockers

| Blocker | Owner | Ref |
|---|---|---|
| Legacy 9Router and CatGPT references in code and `.env.example` | Agent A | KI-001 |
