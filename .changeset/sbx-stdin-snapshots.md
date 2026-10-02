---
"@computesdk/cli": patch
---

`compute sandboxes` covers the new `/v1` surface: `spawn --stdin` keeps a job's stdin pipe open, `stdin`/`close-stdin` write and close it (`--data`, `--file`, or piped; `--base64` for binary), `snapshots`/`snapshot`/`snapshot-delete` wrap the snapshot CRUD, and `get`/`list`/`attach` now show the effective image and attach region.
