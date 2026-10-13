---
'@computesdk/isorun': patch
---

Wire `sandbox.create({ snapshotId })` to `Isorun.restore(snapshotId)` — the option was silently ignored, so restoring a snapshot booted a fresh image without the snapshotted filesystem.
