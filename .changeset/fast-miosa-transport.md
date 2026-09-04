---
"@computesdk/miosa": patch
---

Expose an awaited MIOSA transport-readiness boundary and use one multiplexed HTTP/2 session by default so burst TTI does not include a pool of cold TLS handshakes.
