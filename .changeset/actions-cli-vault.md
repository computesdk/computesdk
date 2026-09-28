---
"@computesdk/cli": patch
---

Add `compute actions vault ls|set|get|rm` for the org vault (secrets and variables) over `/api/v1/vault`. `set` reads the value from stdin or `--from-file` and sends it exactly as read; `get` prints a variable or a secret created `--revealable`.
