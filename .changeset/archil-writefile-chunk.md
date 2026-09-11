---
"@computesdk/archil": patch
---

Chunk base64-encoded file writes in `writeFile` so each `runCommand` stays below Archil's 102,400-byte command limit. This fixes writing files larger than ~75 KiB through the provider's filesystem API.

Compress writes with gzip when the compressed payload fits in a single command, reducing the number of `exec` calls for repetitive or compressible content. Checkout and checkin the target parent directory once per write (first and last chunk) instead of on every chunk.