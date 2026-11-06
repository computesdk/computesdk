---
"@computesdk/agent37": patch
---

Chunk UTF-8 file writes within Agent37's exec request limit and stage each transfer privately in remote TMPDIR before an in-place overwrite, without requiring destination-directory write permission. Preserve existing permissions, hard links and symlink-following behavior. Use flock when available to prevent interleaved concurrent SDK writes; custom images without it retain ordinary redirection behavior.
