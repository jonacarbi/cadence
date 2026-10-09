# Testing

| Check | Command |
|---|---|
| Server tests | `npm test` (node:test, 77 passing on 2026-10-09) |
| Doctor | `npm run doctor` (exit 1 when something blocks Cadence) |
| Fresh clone | `git clone`, copy the working tree over it, `npm run setup`, `npm start` with `CADENCE_DIR` and `PORT` set to scratch values |
| Swift build | `swift build --package-path mac` |
| Live smoke | `CADENCE_LIVE_SMOKE=1 node scripts/smoke-agent.mjs` (opt-in) |
| Site screenshots | Playwright with system Chrome at 390 and 1440, light and dark, check `scrollWidth - innerWidth` is 0 |

Screenshots are in `docs/site-screens/`. CI is `.github/workflows/ci.yml`: Node 24 on ubuntu, macos, windows, plus a macOS Swift build. The workflow has not run yet.
