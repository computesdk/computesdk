---
"@computesdk/agent37": patch
---

Chunk UTF-8 file writes within Agent37's exec request limit and stage each transfer privately in remote TMPDIR before a locked in-place overwrite, without requiring destination-directory write permission. Preserve existing permissions, hard links and symlink-following behavior while preventing interleaved concurrent SDK writes.
