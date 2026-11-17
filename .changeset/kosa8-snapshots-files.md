---
"@computesdk/kosa8": minor
---

Add snapshots (`provider.snapshot` create, list and delete, and `create({ snapshotId })` to restore one, memory and running processes included), boot OCI images with `create({ image })`, and move file content as raw bytes through kosa8's file stream at any path: straight to the sandbox's host with the direct token when it covers files, else through the API; one request up to 64 MiB, parallel 64 MiB offset/range parts above that, and exec on older hosts. `runCommand` results report output the API truncated (`truncated`, `stdoutTruncated`, `stderrTruncated`, `stdoutBytes`, `stderrBytes`).
