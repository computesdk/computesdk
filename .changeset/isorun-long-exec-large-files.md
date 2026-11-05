---
'@computesdk/isorun': patch
---

Run commands detached and poll for completion so commands longer than Isorun's ~120s exec request cap finish (and `timeout` kills them), apply `env`/`cwd` to every part of a compound command, and move large files and command output in small verified chunks: multi-MiB downloads/exec bodies truncate and drop the sandbox console, and uploads above 4 MiB silently corrupt.
