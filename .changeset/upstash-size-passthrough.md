---
"@computesdk/upstash": patch
---

Pass through the `size` option (and `env`) when creating ephemeral Upstash boxes, so sandbox sizing is honored on both the persistent and ephemeral creation paths.
