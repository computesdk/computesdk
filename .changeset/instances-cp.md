---
'@computesdk/cli': patch
---

`compute instances cp` — copy files and directories between the local filesystem and a sandbox through the platform transfers API (`POST /sandboxes/{id}/transfers` + `/complete`). Remote side is `[id:]/abs/path` (omitted id = current instance); upload tars locally, PUTs to a presigned URL, and the box extracts; download reverses it. Prints `copied N files (size) → dest` (`-q` prints nothing; TTY progress past 10 MB).
