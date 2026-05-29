---
"daemond": minor
"@computesdk/provider": minor
"computesdk": minor
---

Fix `background: true` being a black hole — route background commands through the daemon

### What changed

**`daemond`**
- `SeedCommandInput` gains a `background?: boolean` field. When set, the daemon spawns the process detached and returns a `jobId` immediately instead of waiting for the process to exit.
- `SeedCommandResult` gains an optional `jobId?: string` field, populated for background invocations.
- New `SeedJobStatus` type describes the status of a background job.
- New export `daemonSeedScriptJobReadCommand(config, jobId)` — generates a shell command that queries the daemon for buffered output and running status of a background job.
- New export `parseSeedJobStatusOutput(raw)` — parses the JSON printed by the job-read command.
- Daemon runtime: new `job_read` wire message type; background jobs capture the last 256 KB of stdout/stderr in a ring buffer and continue publishing SSE events while running.

**`@computesdk/provider`**
- Removed the `throw` that rejected `runCommand` when both streaming callbacks and `background: true` were provided together.
- `background: true` (with or without streaming callbacks) now routes through the daemon instead of bypassing it to the provider's hand-rolled `nohup` path.
- Background calls return a `CommandResult` immediately with `jobId` set; streaming callbacks, if provided, receive live output via a fire-and-forget SSE subscription.

**`computesdk`**
- `CommandResult` gains an optional `jobId?: string` field.
- Re-exports `daemonSeedScriptJobReadCommand`, `parseSeedJobStatusOutput`, and `SeedJobStatus` from `daemond`.
