---
"@computesdk/blaxel": patch
---

Fix `runCommand` returning empty `stdout`: pass `onStdout`/`onStderr` callbacks so `@blaxel/core` uses its `execWithStreaming` path (handles `stdout`, `stderr`, `logs`, and streamed `result` events), fall back to `process.logs(pid)` when output is empty, and report a nonzero exit code when the API returns `status: "failed"`.
