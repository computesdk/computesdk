---
"@computesdk/namespace": patch
"@computesdk/createos-sandbox": patch
---

Volume fixes round 3: namespace delete paginates the id→tag lookup and tolerates list outages (falls back to the given tag); createos forks destroy themselves when a post-fork volume attach fails instead of leaking a running sandbox.
