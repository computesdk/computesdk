'@computesdk/daytona': patch
---

Fix `snapshot.create` calling `daytona.snapshot.create({ workspaceId, name })` — that API registers a declarative snapshot from an `Image` definition, so the call crashed with `Cannot read properties of undefined (reading 'contextList')`. It now captures the running sandbox's filesystem via `Sandbox.createSnapshot` (falling back to `_experimental_createSnapshot` on SDK versions where the method is still experimental) and returns the snapshot name as its id, which `sandbox.create({ snapshotId: name })` restores.
