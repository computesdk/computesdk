---
"@computesdk/browserbase": patch
---

Fix file type mismatch in @computesdk/browserbase package.json

- Correct `main` to point to `./dist/index.cjs` (CommonJS) instead of `./dist/index.js`
- Correct `module` to point to `./dist/index.js` (ESM) instead of `./dist/index.mjs`
- Update `exports` map to match the corrected entry points
