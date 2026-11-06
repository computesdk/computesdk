---
'@computesdk/sandbox0': patch
---

Map the unified `timeout` create option onto the claim's `ttl`/`hardTtl` (seconds), so a requested lifetime is honored instead of ending at the platform default TTL. Native `ttl`/`hardTtl` still take precedence.
