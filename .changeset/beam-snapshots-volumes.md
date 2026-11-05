---
'@computesdk/beam': patch
---

Add snapshots (memory + filesystem checkpoints restored with `snapshotId`), mount volumes at the requested path, move files over 8 MiB in parts below the gateway message cap, and apply `env`/`cwd` to every part of a compound command.
