# Deploy

Site: Netlify project `cadence-social-agent`, id 8be629f0-8408-4d07-862b-1f5e01479b44.

```
netlify deploy --prod --dir site --site 8be629f0-8408-4d07-862b-1f5e01479b44
```

Live: https://cadence-social-agent.netlify.app. Headers and CSP are in `site/netlify.toml`; the CSP allows only Google Fonts hosts. Preview locally with `python3 -m http.server --directory site 8899` (do not open the file directly, asset paths are root-relative).

Mac app: `scripts/build-macos.sh` builds `build/Cadence.app`. `scripts/release-macos.sh` signs and notarizes; needs DEVELOPER_ID and a notary profile, neither stored in the repo.
