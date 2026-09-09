---
"@computesdk/miosa": patch
---

Expose an awaited MIOSA transport-readiness boundary (`readyMiosaConnections`) and shrink the default HTTP/2 pool from 16 sessions to 4 so a burst's first timed request does not wait on a pool of cold TLS handshakes.
