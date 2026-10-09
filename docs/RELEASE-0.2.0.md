# Cadence 0.2.0 — local release

> Historical notes for the original macOS-only release, written against the maintainer's own setup (9Router, CatGPT, launchd). Those are no longer required: 0.3.0 lets you pick your own AI agent. See the README and CHANGELOG for current behavior.

## Delivered

- Native Content agent tab accepts a website or prompt, creates a brand identity when needed, and produces one post or a daily month across the brand’s active connected platforms.
- Brand-first onboarding waits for account connections. Progress and errors survive relaunch; validated planning batches and cached images are reused on resume.
- Platform caption editing, visual preview, timezone-aware calendar placement, version-checked batch approval and atomic scheduling.
- Text: user-selected `cx/gpt-5.6-terra` through 9Router. Visuals: user-selected Open Generative AI MCP → CatGPT, using its `chatgpt` gateway alias. The MCP does not expose or verify the underlying browser image-model version.
- MCP child processes close in `finally`; CatGPT is pinned for Cadence, with an eight-minute image wait, routing around unhealthy accounts, and no fallback to other image providers.
- Settings readiness checks cover text configuration, browser rendering, MCP installation, real accounts and media hosting. The image check probes the gateway's live status, so a recorded rate limit reads as not ready with the hours until reset. A clear result is worded as “no rate limit recorded” rather than “ready to generate”: the gateway counts real 429s, and a plan's own image allowance arrives as ordinary reply text it never sees.

## Reliability fixes

- Fixed native decoding for manual account connection, settings save and visual rerender actions.
- Corrected publish-now delivery creation and rollback; enforced daily account caps, stale-edit protection and atomic bulk scheduling.
- Restored Bluesky handle-based login; preserved Instagram/Threads publication receipts if permalink lookup fails. Added media-caption validation for Telegram.
- Updated LinkedIn's default API version to `202609`, configurable via `CADENCE_LINKEDIN_VERSION`. The previous `202409` version was sunset. Sources: [LinkedIn versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning), [migration notice](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations?view=li-lms-2024-10).
- Visuals use the campaign’s pinned brand snapshot, export JPEG, and carry matching content types into platform uploads. Image production invalidates stale approvals and reports partial failures accurately.
- Website extraction runs headlessly with public-only, DNS-pinned network requests, including subresources. Logo, source and caption-link fetches and webhooks use the guarded transport. Asset reads resolve symlinks before checking brand/asset roots.
- OAuth state expires; settings validate before mutation; custom rules are persisted outside the signed bundle. Public-media bucket creation retries once instead of recursing indefinitely.

## Verification

- All 57 server tests pass. The suite covers authentication, brand isolation, workflow transitions, concurrency, ambiguity, daily caps, full-month dates, checkpoint recovery, full-month batch planning and mid-run resume, image-quota readiness, the brand image library, watched-feed ingestion, cross-platform repurposing, credential storage, a request-level contract test for every publish adapter, the sleep backlog hold, best-hour scheduling, atomic approvals, native response shapes, provider regressions, MCP provider pinning, path confinement and child cleanup.
- Swift release compilation and ad-hoc bundle signature verification.
- Native UI inspection of the installed Content agent, monthly controls and Settings checks.
- Live website extraction against `https://example.com`.
- Live `cx/gpt-5.6-terra` monthly check passed: 31 October posts, 124 captions across four platforms, unique daily dates and platform length validation. Visual generation was tested separately.
- Earlier direct-CatGPT smoke check passed image generation, JPEG rendering, approval, scheduling and mock delivery. The final MCP path passes protocol, provider pinning, healthy-account routing, path confinement and process-cleanup tests. Its live image attempt timed out while the CatGPT account logs reported image quota exhaustion; live MCP image generation remains unverified until quota resets.
- Tests use isolated databases and synthetic brand data. Reports are in `build/release-check/`; these are local artifacts, not committed fixtures. No real social publication was performed.

## Remaining setup and distribution limits

The user's existing workspace contains only mock accounts. Real account sign-in and a live-provider publishing check remain required. OAuth platforms need their developer-app configuration; Instagram, Threads and TikTok image posting needs public media hosting (Pinterest uploads the bytes directly, so it does not). Reddit is a registered platform (posting to the connected account's own profile subreddit by default) but still needs a Reddit app registration before sign-in works.

TikTok posts through the Content Posting API's photo lane. Two of its constraints shape the adapter: an unaudited client may only post at a restricted privacy level, so the adapter reads `privacy_level_options` from the account rather than assuming public; and PULL_FROM_URL requires the media host's domain to be verified in the developer portal, which is a portal step no code can cover.

YouTube stays unimplemented on purpose. Cadence produces still images, and `videos.insert` requires a video file; Community posts, the one image-shaped surface, have no public API. Implementing it would mean adding video generation, which is out of scope, so the platform is declared but reports `available: false` rather than offering a lane that cannot publish.

The current ARM64 bundle is ad-hoc signed for local use. A public customer release needs Developer ID signing, notarization, an installation strategy for the external MCP/9Router/CatGPT dependencies, and any required platform app review. There is no claim of completed public distribution or validated real-account publishing.


Database backups are stored under Application Support/Cadence/backups. Previous installed app bundles and local configuration backups are retained. Existing brands, credentials and drafts are preserved.
