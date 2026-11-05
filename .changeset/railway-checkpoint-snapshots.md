---
'@computesdk/railway': patch
---

Add snapshot support backed by Railway sandbox checkpoints (create, list, delete, and restore via `sandbox.create({ snapshotId })`), and move the filesystem onto Railway's native `sandbox.files` API.
