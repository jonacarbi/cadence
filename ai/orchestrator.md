# Cadence AI docs: start here

Ground truth as of 2026-10-09. Cadence is a local-first social media agent: Node 24 server on :8796 (`server/`), browser UI (`server/web/`), SwiftUI macOS app (`mac/`), landing page (`site/`).

Never edit: the owner's `~/Library/Application Support/Cadence` data, and any file owned by another agent during the open-source release (see Roles).

## Evidence states

| State | Meaning |
|---|---|
| OBSERVED | Seen in the repo, a build, a test or a live URL. Source named. |
| INFERRED | Implied, not checked directly |
| PLANNED | Required by the brief, not built or not verified |
| PROPOSED | A suggestion, not binding |
| UNKNOWN | No evidence |

## Roles (open-source release, 2026-10)

| Agent | Owns |
|---|---|
| A Engine | `server/src` except `api.js`, server tests, `server/package.json`, `server/bin`, run and service scripts, `.env.example` |
| B Studio | `server/web` except favicon and mark, `server/src/api.js`, `web.test.js`, `mac/Sources` |
| C Launch | `brand/`, `site/`, `ai/`, README and community files, `.github`, `docs/`, `mac/Resources`, build and release scripts, `HANDOFF.md` |

## Change protocol

1. The code wins over these docs. Fix the docs.
2. Every code change updates `project-state.md` and `changelog.md`.
3. Generated assets (brand PNG, ICO, ICNS) are regenerated from the SVG sources, never hand-edited.
4. Run `validation-checklist.md` before calling anything done.

## Routing

| Domain | Load |
|---|---|
| What is live, what is next | `project-state.md` |
| Why a choice was made | `decisions.md` |
| Logo, voice, tokens | `brand.md`, `design-system.md` |
| Landing copy and platforms | `content.md` |
| Deploy the site or app | `deploy.md` |
| Tests | `testing.md` |
| Open problems | `known-issues.md` |
| Recurring chores | `maintenance.md` |
