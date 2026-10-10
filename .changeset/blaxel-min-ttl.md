---
'@computesdk/blaxel': patch
---

Raise any sandbox/preview ttl below Blaxel's 5-minute minimum to `300s` (with a warning) instead of sending it and failing `ttl … is too short: the minimum is 5m`. Destroy still ends the box early, so billing stays on actual use.
