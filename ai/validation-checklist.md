# Validation checklist

- [ ] `npm test` passes
- [ ] `site/` has no horizontal overflow at 320, 390, 1440 in both themes
- [ ] Site returns 200 and the CSP, HSTS, nosniff headers
- [ ] Every command in README and `site/app.js` runs on a clean checkout
- [ ] Platform list matches `server/src/providers/registry.js`
- [ ] Safety numbers match `server/src/safety.js`
- [ ] Secret and personal path scan of tree and history is clean
- [ ] No em dashes or filler in site copy
