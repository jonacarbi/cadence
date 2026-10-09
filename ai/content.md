# Content

Source: `site/index.html`.

Hero: "Your brand, on beat." Lede: paste a website, get a month of posts, you approve, Cadence publishes.

Platforms (12, each has an adapter in `server/src/providers/`): Instagram, Facebook, LinkedIn, X, Threads, Bluesky, Mastodon, Pinterest, TikTok, Reddit, Telegram, Discord. YouTube is not supported.

Agents: Claude Code, Codex, Gemini, opencode, any OpenAI-compatible endpoint.

Claims that must stay true:

| Claim | Backed by |
|---|---|
| Official APIs only | adapters in `server/src/providers/` |
| Caps, 90 min gap, 7 min jitter, 14 day warm-up | `server/src/safety.js` |
| Human approval by default | autonomy default review-all |
| Install commands | PLANNED from the brief, verify against `server/bin` |
