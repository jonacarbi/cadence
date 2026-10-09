# Contributing to Cadence

Thanks for helping. Keep changes small and tested.

## Setup

```bash
git clone https://github.com/jonacarbi/cadence.git && cd cadence
npm run setup
npm test
```

Needs Node 24 or newer (`node:sqlite`). The macOS app also needs Xcode command line tools (`swift build --package-path mac`).

## Ground rules

- Node standard library first. A new npm dependency needs a reason in the PR.
- Keep files under 400 lines. Comments explain why, not what.
- Non-trivial logic gets a `node:test` test in `server/tests`.
- Security model stays: loopback only, Host pinned, bearer tokens, account tokens encrypted at rest, keys AES-GCM sealed in a 0600 settings file, secrets never echoed by the API.
- Publishing goes through official platform APIs only. No scraping, no password logins, no browser automation to post.
- Never commit secrets, tokens, real account names or personal paths.
- Test on Windows and Linux paths when touching file, process or shell code.

## Pull requests

Use [conventional commits](https://www.conventionalcommits.org/) (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`). Fill in the PR template. CI must pass on all three operating systems.

## Adding a platform

Add an adapter in `server/src/providers/`, register it in `registry.js`, add OAuth or manual-credential metadata, and a request-level contract test. Document developer-app requirements in `docs/CONNECT-ACCOUNTS.md`.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security issues go through [SECURITY.md](SECURITY.md).
