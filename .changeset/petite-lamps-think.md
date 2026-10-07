---
"@computesdk/cli": patch
---

fix(cli): pass flags inside `sandboxes exec`/`spawn` commands through to the sandbox. `exec <id> uname -a` and `spawn <id> node -e "…"` no longer get eaten as CLI options; CLI options go before the command and `--` still works.
