---
"@computesdk/e2b": patch
---

Serve streaming `runCommand` and `startProcess` natively over E2B's process API (live output, stdin, signals) instead of the shell process tier. Commands run in their own process group so timeouts and kills stop the whole tree; `runCommand` no longer stops at E2B's 60s default, reports timeouts as exit 124, and passes `env`/`cwd` natively (fixing `background` with `env`/`cwd`).
