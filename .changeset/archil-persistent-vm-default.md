---
'@computesdk/archil': patch
---

**Breaking default:** `archil()` now creates persistent Archil VMs. `sandbox.create()` with no disk id provisions a VM (honoring `name`, `baseImage`/`image`, `env`, `vcpus`/`memoryMiB` or `sizeClass`, and `timeout`/`maxTtlSeconds`), and `getById`, `list` and `destroy` operate on VMs. Commands, streaming and `startProcess` run on Archil's native process API, with `env` and `cwd` applying to every part of compound commands. Snapshots are paused VM forks that can now be listed, and `create({ snapshotId })` restores them.

The disk exec mode is opt-in: pass `archil({ execution: 'exec' })` (or set `ARCHIL_EXECUTION=exec`) together with `create({ diskId })`. Passing `diskId` without opting in now throws instead of returning a disk handle.
