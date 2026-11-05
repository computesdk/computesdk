---
"@computesdk/modal": patch
---

Look up the Modal app on first sandbox create instead of at `modal()` construction, so a missing-credentials lookup no longer surfaces as an unhandled rejection and a failed lookup is retried.
