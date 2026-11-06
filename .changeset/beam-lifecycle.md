---
"@computesdk/beam": patch
---

Declare snapshot capabilities: Beam memory snapshots keep running processes and the root filesystem (not the `/mnt/code` working-directory mount) and leave the source running. Snapshot conformance tests are enabled.
