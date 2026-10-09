# Cadence landing page

Static HTML/CSS plus a little JS. No build step.

- Live: https://cadence-social-agent.netlify.app
- Preview: `python3 -m http.server --directory site 8899`
- Deploy: `netlify deploy --prod --dir site --site 8be629f0-8408-4d07-862b-1f5e01479b44`
- Install commands live in one place: `CMD` in `app.js` (the no-JS fallback in `index.html` must match).
- Security headers and CSP: `netlify.toml`. Fonts come from Google Fonts, so the CSP allows only those two hosts.
