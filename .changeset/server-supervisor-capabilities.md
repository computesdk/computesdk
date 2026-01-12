---
"computesdk": minor
"@computesdk/workbench": patch
---

Add supervisor/daemon capabilities to server service

- Add restart policies: `never`, `on-failure`, `always`
- Add graceful shutdown with configurable timeout (SIGTERM → wait → SIGKILL)
- Add inline environment variables support
- Add process monitoring with `restart_count` and `exit_code` tracking
- Expose server namespace in workbench REPL for testing
