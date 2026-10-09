# Security policy

## Reporting a vulnerability

Please report privately through GitHub: [Report a vulnerability](https://github.com/jonacarbi/cadence/security/advisories/new). Do not open a public issue.

Include what you found, how to reproduce it, and the impact. You will get an acknowledgement within a few days. Cadence is maintained by one person, so fixes are best effort.

## Scope

Cadence runs on your own machine. In scope: the local server (auth, Host and Origin checks, the browser session, credential storage, SSRF guards on fetches and webhooks, path confinement), the MCP server and the OAuth flows.

## Model in brief

Loopback only, Host pinned, owner and agent bearer tokens, account sign-in tokens encrypted with AES-256-GCM at rest, API keys, app secrets and the webhook secret sealed with the same key in a settings file readable only by your user (0600 on macOS/Linux, your profile ACL on Windows); the key file sits beside it, so this protects copies of the settings file, not a compromised user account, secrets never returned by the API. Agent jobs whose prompts carry website text (brand codification, design critics) run Claude Code with no shell, no web, no user settings and path-scoped file access, so they cannot read the settings file or write outside their output folder. Claude Code and Codex also get explicit deny rules for Cadence's own secrets (key file, tokens, settings file, database, backups, TLS key) in every mode; Codex runs in a read-only permission profile with no writes or network. Gemini CLI and opencode have no per-path deny, so with them an agent could still read any file your user can; use Claude Code, Codex or an OpenAI-compatible HTTP provider if that matters to you. See the README for details.

## Supported versions

Only the latest release on `master`.
