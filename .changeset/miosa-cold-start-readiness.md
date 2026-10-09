---
'@computesdk/miosa': patch
---

Establish HTTP/2 sessions before a cold client dispatches its first request, so the first burst spreads across the pool instead of queueing on a single session, and size the default pool at 4 sessions.
