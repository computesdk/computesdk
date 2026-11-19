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

Add `sizes` resolvers to more sandbox providers so `create({ sizeClass })` either provisions the standard shape or fails loudly instead of silently mis-sizing. Providers with real create-time CPU/RAM knobs now map every standard class (neevcloud, isorun, microsandbox, modal, railway, runloop) or the subset they can deliver (uno, buddy, givemeanode, codesandbox via VMTier, tensorlake). Providers whose size is fixed by a template/plan or that expose only one dimension declare `unsupported` (blaxel, boat, daytona, hopx, kosa8, lelantos, lightning, northflank, sandbox0, sprites, upstash, vercel, beam).
