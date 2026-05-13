---
"computesdk": patch
---

Add `daemond` as a runtime dependency and re-export daemon seed helpers/types from the `computesdk` package entrypoint.

Also extend `RunCommandOptions` with an optional `daemon` field (`boolean | SeedScriptConfig`) so provider-backed sandboxes can opt into daemonized command execution via `sandbox.runCommand(...)`.
