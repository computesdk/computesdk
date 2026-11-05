---
"@computesdk/namespace": patch
---

Support on-demand snapshots via persistent volumes. Opt in with `snapshotVolume: true` (provider config or create option) to attach a persistent volume at `/workspace` (also the default cwd). `snapshot.create` shuts the sandbox down and waits for the volume snapshot to commit; `create({ snapshotId })` restores it into the container (fanout supported). `snapshot.list`/`delete` work against the committed volume snapshots. Only the volume is preserved, not the rootfs.
