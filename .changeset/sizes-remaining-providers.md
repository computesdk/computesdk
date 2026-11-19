---
'@computesdk/boat': patch
'@computesdk/northflank': patch
'@computesdk/neevcloud': patch
'@computesdk/microsandbox': patch
'@computesdk/hopx': patch
'@computesdk/kosa8': patch
'@computesdk/lelantos': patch
---

Add standard `sizeClass` resolvers: boat (`type` presets for md–2xl), northflank (`deploymentPlan` for xs–2xl), neevcloud and microsandbox (exact CPU/memory for every tier). hopx, kosa8 and lelantos take a `sizeTemplates` config with one template per size and report `unconfigured` for sizes without one.
