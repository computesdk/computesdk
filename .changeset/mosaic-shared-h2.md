---
"@computesdk/mosaic": patch
---

Reuse process-shared HTTP/2 connections for Node HTTPS endpoints while preserving the existing request queue and HTTP/1.1 fallback. Add an http2 opt-out for custom transports.
