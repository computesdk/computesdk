---
'@computesdk/arker': patch
---

Keep an Arker sandbox running between commands, as other providers do, so background processes keep running: for its `timeout` (5 minutes when unset, no limit at `0`) or until it is destroyed. The sandbox is billed as running while it is held, and then pauses between commands again; `getInfo().timeout` reports the window instead of `0`. `keepAwake: false` keeps the previous behaviour.
