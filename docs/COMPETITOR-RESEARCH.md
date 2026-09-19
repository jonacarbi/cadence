# Competitor research and delivery ledger

Research date: 2026-09-18. This is a capability ledger, not a claim of parity.

## Sources inspected

- [TryPost](https://github.com/trypostit/trypost): README and `app/Console/Commands/ProcessScheduledPosts.php`. Its scheduler conditionally changes a due post to publishing before dispatch. Cadence uses SQLite transactions to claim individual account deliveries. No source copied.
- [Postiz](https://github.com/gitroomhq/postiz-app): repository tree, README and `libraries/nestjs-libraries/src/integrations/social/mastodon.provider.ts`. Its media processing is separated from final publishing, with stable idempotency keys across finalization retries. Cadence persists delivery receipts and holds ambiguous sends for reconciliation. No source copied.
- [Pendpost](https://pendpost.com/): owner approval, editable lint rules, circuit breakers, explicit autonomy, local operation. Cadence separates agent/owner API tokens and invalidates approval after edits.
- [LangChain social-media-agent](https://github.com/langchain-ai/social-media-agent): README, repository tree, and `src/agents/generate-post/generate-post-graph.ts`. Useful patterns: source deduplication, content report before drafting, bounded rewriting, human review after every revision, and resumable steps. No source copied.

These projects are references, not dependencies. TryPost and Postiz advertise AGPL-3.0; LangChain's agent advertises MIT. Any later code reuse requires explicit provenance and license handling.

## Capability ledger

| Area | Required behavior | Cadence status |
| --- | --- | --- |
| Brand workspaces | Isolated clients, stored identity and voice | Local brand records and account isolation implemented; extraction pending |
| Design memory | Website evidence, reusable DNA, reference and tested reconstruction | Pending |
| Monthly agent | Research, pillars, platform-specific captions, full calendar | Pending |
| OpenAI images | High-quality images with brand constraints and visual review | Inherited adapter; hardening and integrated validation pending |
| Approval | Review, reject, edit, reapprove, optimistic concurrency | Implemented and tested through local REST API |
| Scheduler | Atomic claiming, per-destination receipts, restart handling | Implemented and tested with injected providers |
| Circuit breaker | Pause lanes on explicit blocks/repeated failures | Core implemented; provider error classification pending |
| Social publishing | 12 primary networks and expanded Postiz destinations | Capability metadata only; adapters pending |
| Calendar/composer | Month/week/day, rescheduling, previews, tags | Pending |
| Media | Library, uploads, carousels, video, repurposing | Pending |
| Collaboration | Review comments, roles, client review | Schema only; single-owner authentication currently |
| Analytics | Real metrics, refresh, reporting | Schema only |
| Automation | REST, MCP, source ingestion and recurring campaigns | Core REST implemented; others pending |
| macOS shipping | Native app, runtime bundle, background agent, signing/notarization | Pending |

## Reliability decisions

An outbound timeout is not proof of failure. A delivery with an uncertain remote outcome is held, never blindly retried. A receipt belongs to an account and a content version. Editing a scheduled draft advances its version, so its old delivery rows cannot publish. Restart recovery holds interrupted sends for owner review. No connected account or mock adapter is silently substituted for an unavailable integration.

## External acceptance prerequisites

Live publishing needs user-authorized social accounts and platform API access. Signed public distribution needs an Apple Developer signing identity and notarization credentials. A local scheduler needs the Mac running and awake; a launch agent cannot publish while hardware is off. These prerequisites do not prevent implementing or testing the remaining local app.
