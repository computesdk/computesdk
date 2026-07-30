---
'@computesdk/beam': patch
---

Improve Beam sandbox startup: create sandboxes with `waitForReady: false` and lazily await readiness (via `Sandbox.connect`) only for operations that require a running container (`getUrl`, `readdir`). Terminate through `Sandbox.terminate(sandboxId)` instead of connecting first, and bump `@beamcloud/beam-js` to `^1.0.17`.
