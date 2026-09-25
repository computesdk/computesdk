---
"@computesdk/cli": patch
---

Harden `compute actions`: structured JSON error envelope under `--json`, stored `compute bench auth login` platform credentials as an auth fallback (flag > env > stored), HTTPS required for non-loopback base URLs, and an explicit `--manual` dispatch option.
