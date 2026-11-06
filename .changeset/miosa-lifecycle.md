---
'@computesdk/miosa': patch
---

Sandboxes expose native `pause()`/`resume()` on the instance (Firecracker runtime; files and processes survive), declared in `provider.sandbox.pause`, and snapshots declare `snapshot.capabilities` (memory and whole rootfs, source keeps running). `runtime` can be set per create (`sandbox.create({ runtime: 'firecracker' })`). `snapshot.create` now waits until the snapshot is ready, so `create({ snapshotId })` can restore it straight away. The package runs the live conformance suite, including pause/resume and snapshot restore.
