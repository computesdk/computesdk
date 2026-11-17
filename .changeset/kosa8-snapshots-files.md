---
"@computesdk/kosa8": minor
---

Add snapshots (`provider.snapshot` create, list and delete, and `create({ snapshotId })` to restore one, memory and running processes included), boot OCI images with `create({ image })`, and move file content through kosa8's file API: one request for a file under `/workspace` up to 8 MiB, parallel 4 MiB parts for larger files and other paths, so reads and writes of any size work.
