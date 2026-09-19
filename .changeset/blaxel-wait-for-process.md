---
"@computesdk/blaxel": patch
---

fix(blaxel): wait for process completion before recovering runCommand output

On current Blaxel infra, `process.exec` returns promptly with `status: 'running'` even with `waitForCompletion: true`, leaving all output fields empty. `executeWithStreaming` now polls `process.wait(pid)` to a terminal state (bounded by the command timeout, 5 min default) before falling back to `process.logs(pid)`, and best-effort kills the process if the wait times out.
