'@computesdk/daytona': patch
---

Fix `snapshot.create` calling `daytona.snapshot.create({ workspaceId, name })` — that API registers a declarative snapshot from an `Image` definition, so the call crashed with `Cannot read properties of undefined (reading 'contextList')`. It now captures the running sandbox's filesystem via `Sandbox#_experimental_createSnapshot(name)` and returns the snapshot name as its id (restores go through `create({ snapshotId: name })`).
