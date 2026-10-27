---
"@computesdk/miosa": patch
---

Bound the readiness poll's 404 tolerance to an attach window. waitForRunnerReady treated any 404 from the per-sandbox GET as "still launching" for the whole 180s budget, but a sandbox the runner never owned (created through the account API, then reattached via getById/list with an unrecorded origin) 404s forever — the poll stalled the command, then threw a plain error the wrong-endpoint fallback couldn't recognize, so every exec on such a handle failed instead of falling back to the account API. A 404 that outlives the 30s attach grace now rethrows, restoring the fallback. The fallback also only learns the "account" route once the account API answers a non-404: a regional sandbox still attaching 404s on the runner too, and caching the route on that signal alone would misroute the handle's later commands.
