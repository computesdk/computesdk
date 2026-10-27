---
'@computesdk/cli': patch
---

instances UX: compact human output for create/get/list (`--verbose` for the old detail view), `-q/--quiet` for script-friendly IDs and URLs, a per-directory current instance (`use`, `COMPUTE_INSTANCE`, implicit ID resolution across all commands), and `run` (create + spawn + wait + destroy in one command, with `--keep` and `-d` modes and an interactive Ctrl-C prompt).
