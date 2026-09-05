---
"@computesdk/archil": patch
---

Chunk base64-encoded file writes in `writeFile` so each `runCommand` stays below Archil's 102,400-byte command limit. This fixes writing files larger than ~75 KiB through the provider's filesystem API.