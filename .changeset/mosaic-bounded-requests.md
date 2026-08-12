---
'@computesdk/mosaic': patch
---

Bound how many HTTP requests the Mosaic provider keeps in flight, so a burst of concurrent sandbox creates no longer becomes a burst of TLS handshakes. Configurable with `maxConcurrentRequests` (default 32; `Infinity` restores the previous behaviour).
