---
"computesdk": minor
"@computesdk/provider": minor
---

Add `daemond` as a runtime dependency and re-export daemon seed helpers/types from the `computesdk` package entrypoint.

Also extend `RunCommandOptions` with an optional `daemon` field (`boolean | SeedScriptConfig`) so provider-backed sandboxes can opt into daemonized command execution via `sandbox.runCommand(...)`.

In `@computesdk/provider`, add runtime handling for `runCommand(..., { daemon })` in generated sandbox instances: commands are routed through `daemond` seed launcher, parsed, and normalized into `CommandResult`.

Also add daemon output callback support via `RunCommandOptions.onStdout` / `RunCommandOptions.onStderr`. When daemon SSE is available from a prior daemon invocation, callbacks receive streamed command chunks; otherwise callbacks receive final parsed stdout/stderr as fallback.
