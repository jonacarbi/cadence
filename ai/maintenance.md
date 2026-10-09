# Maintenance

**Trigger: a platform adapter is added or removed.** Update the site platform list and heading count, `README.md`, `docs/CONNECT-ACCOUNTS.md`, `content.md`.

**Trigger: install commands change.** Edit `CMD` in `site/app.js` and the fallback in `site/index.html`, then README, then redeploy.

**Trigger: safety defaults change.** Update `docs/SAFETY.md`, README, site safety section.

**Trigger: logo change.** Edit the SVGs, regenerate PNG, ICO and ICNS, copy to `server/web/` and `site/`, rebuild the Mac app.

**Trigger: before each release.** Run `validation-checklist.md`, update `CHANGELOG.md`, run the secret scan.
