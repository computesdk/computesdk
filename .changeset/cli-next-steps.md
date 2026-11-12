---
"@computesdk/cli": patch
---

`compute sandboxes create` / `compute new` now say how to use the sandbox next — exec a command, start a server, get its public URL, destroy it — and that it bills until it's destroyed (on stderr; skipped with `-q`/`--json`).
