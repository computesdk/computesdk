---
"@computesdk/sail": patch
---

Expose Sail checkpoints as snapshots: `snapshot.create` checkpoints a Sailbox, `sandbox.create({ snapshotId })` starts a new Sailbox from it, and `snapshot.list`/`delete` use Sail's checkpoint API.
