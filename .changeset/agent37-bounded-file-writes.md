---
"@computesdk/agent37": patch
---

Chunk UTF-8 file writes within Agent37's exec request limit and stage each transfer independently before replacing the destination, preventing partial or interleaved concurrent writes.
