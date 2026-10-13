---
'@computesdk/daytona': patch
---

Fix `snapshot.create` calling `daytona.snapshot.create({ workspaceId, name })` — that API registers a declarative snapshot from an `Image` definition, so the call crashed with `Cannot read properties of undefined (reading 'contextList')`. It now captures the running sandbox's filesystem via the stable `Sandbox.createSnapshot(name)` and returns the snapshot name as its id, which `sandbox.create({ snapshotId: name })` restores. Bumps `@daytonaio/sdk` to `^0.224.0` where `createSnapshot` is stable. Also fix `snapshot.list`/`template.list` returning Daytona's paginated `{ items, total, ... }` object where the framework expects an array — they now return the mapped `items`.
