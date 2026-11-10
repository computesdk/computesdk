---
"@computesdk/agent37": patch
---

Reduce large-file write round trips by using 90 KiB byte chunks within Agent37's documented exec request limit, retaining sequential staging, error handling and overwrite/link/lock semantics.
