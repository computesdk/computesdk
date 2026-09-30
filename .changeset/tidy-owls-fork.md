---
"@computesdk/blaxel": patch
"@computesdk/archil": patch
"@computesdk/namespace": patch
---

Fix snapshot handling in the Blaxel, Archil, and Namespace providers

- `@computesdk/blaxel`: `sandbox.create({ snapshotId })` now forks a new
  sandbox from the workspace snapshot via `Snapshot.get(id).fork(...)`
  instead of treating the id as a live sandbox (`sandboxId` still resumes a
  live sandbox). The snapshot manager now maps to Blaxel's real snapshot
  resources (`Snapshot.create/list/delete`, `sandbox.snapshots`) instead of
  treating sandbox instances as snapshots.
- `@computesdk/archil`: `sandbox.create({ snapshotId })` forks a new sandbox
  from the source sandbox via `POST /api/sandboxes/{id}/fork` (persistent
  mode); `sandboxId` attaches to a live sandbox or disk. Added a snapshot
  manager where `create` forks the source sandbox and `delete` removes the
  backing sandbox (snapshot listing is unsupported — Archil has no snapshot
  resource).
- `@computesdk/namespace`: `sandbox.create({ snapshotId })` restores
  filesystem state by attaching a new PERSISTENT volume seeded via
  `VolumeRequest.from_snapshot_id` (mounted at `/computesdk-data`). Added a
  snapshot manager over the `StorageService` API: `list` enumerates
  persistent-volume snapshots and `delete` abandons one. `create` throws —
  Namespace snapshots are captured automatically on instance shutdown, never
  on demand.
