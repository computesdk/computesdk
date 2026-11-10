---
"@computesdk/upstash": patch
---

Remove the unsupported template manager and empty snapshot inventory shim. Snapshot listing now rejects as unsupported rather than returning a misleading empty list; native snapshot creation, deletion, and restore remain available.
