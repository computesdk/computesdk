---
"@computesdk/namespace": patch
---

Fixed `snapshot.list` and `snapshot.delete` against the real StorageService contract. `ListPersistentVolumeSnapshots` ignores its `id` filter and answers the workspace's full record set in camelCase, so listing now makes one call and joins each record to its volume (the record `id` is the volume id, `completedSnapshot` the generation) instead of re-fetching per volume and emitting duplicates. Listed snapshots are id'd `tag/<gen>` — the form `create({ snapshotId })` restores. `delete` now addresses the artifact by its volume (`{id: volumeId, tag}`) as the RPC requires, accepting `tag/<gen>` or a bare generation, and no-ops when the volume or generation is already gone.
