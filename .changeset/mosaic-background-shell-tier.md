---
'@computesdk/mosaic': patch
---

`runCommand({ background: true })` launches the command detached through the shell process tier instead of Mosaic's durable process API, so `pause()` no longer refuses with 409 `sandbox_busy` while it runs; the process survives pause/resume. The returned `stdout` is the shell job id.
