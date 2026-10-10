# Decisions

## D-001: Editorial Swiss with a musical-score motif (superseded by D-007, 2026-10-10)
Brief: "Not generic SaaS, no gradient blobs." Staff lines, beat ticks, one vermilion accent. Rejected: centered gradient hero, card grids.

## D-002: Newsreader plus Hanken Grotesk (superseded by D-007, 2026-10-10)
Brief names both. Fonts are unique to this project among the owner's sites. The wordmark is outlined to paths so logos render without fonts.

## D-003: Mark is an ink tile, a paper C opening right, a vermilion dot in the opening (superseded by D-007, 2026-10-10)
The dot is the "beat". Reads at 16px. Favicon swaps tile and C in dark mode via an inline media query; the dot stays vermilion.

## D-004: Static landing page on Netlify, no build step (accepted, 2026-10-09)
Plain HTML, CSS and 60 lines of JS. Site name `cadence-social-agent`. Install commands live once in `site/app.js` (`CMD`). Google Fonts is used on the site only; the local app self-hosts.

## D-005: Safety copy promises lower risk, never zero (accepted, 2026-10-09)
Brief: "won't get you banned", phrased honestly. See `content.md`.

## D-006: Docs use `npm run` scripts, the full CLI via `node server/bin/cadence.mjs` (accepted, 2026-10-09)
`cadence` is not on PATH after a clone, so every public command is an npm script (`setup`, `start`, `open`, `doctor`, `test`). `service` and `token` have no script and are documented as `node server/bin/cadence.mjs ...`. `start` blocks, so `open` is shown for a second terminal.

## D-007: Indigo and lime, Funnel Display plus Onest (accepted, 2026-10-10)
The warm paper/vermilion palette read too close to another of the owner's sites. New direction: porcelain and deep indigo, electric indigo for interaction, acid lime only as the "beat" accent. Funnel Display (display) and Onest (UI) are unused in the owner's other projects. The mark keeps its shape: indigo tile, porcelain C, lime dot. The hero is a product proof (a five-step sample run) instead of a decorative visual.
