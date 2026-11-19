---
"@computesdk/beam": patch
"@computesdk/blaxel": patch
"@computesdk/boat": patch
"@computesdk/buddy": patch
"@computesdk/codesandbox": patch
"@computesdk/daytona": patch
"@computesdk/givemeanode": patch
"@computesdk/hopx": patch
"@computesdk/isorun": patch
"@computesdk/kosa8": patch
"@computesdk/lelantos": patch
"@computesdk/lightning": patch
"@computesdk/microsandbox": patch
"@computesdk/modal": patch
"@computesdk/neevcloud": patch
"@computesdk/northflank": patch
"@computesdk/railway": patch
"@computesdk/runloop": patch
"@computesdk/sandbox0": patch
"@computesdk/sprites": patch
"@computesdk/tensorlake": patch
"@computesdk/uno": patch
"@computesdk/upstash": patch
"@computesdk/vercel": patch
---

Add `sizes` resolvers to more sandbox providers so `create({ sizeClass })` provisions the standard shape through each provider's native knob or reports why it can't. Full or partial native mappings: neevcloud, isorun, microsandbox, modal, railway, runloop, daytona, beam, vercel, upstash, uno, buddy, givemeanode, codesandbox, tensorlake. Template-sized providers (kosa8, lelantos, hopx) report `requires-build`; providers whose preset specs are not yet verified (blaxel, sandbox0, boat, lightning, northflank, sprites) report `unknown`.
