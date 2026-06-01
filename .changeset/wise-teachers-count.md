---
"@computesdk/bench": patch
---

Remove the benchmark span log entry cap so all `ctx.log()` entries are included on span events (with existing sanitization).
