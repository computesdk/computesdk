---
"@computesdk/sandbox0": patch
---

runCommand: disable the context idle timeout so quiet long-running commands are not reaped mid-run. Sandbox0 ends a context after `idle_timeout_sec` with no process output; a command that only prints its result at the end (e.g. the fs-io large benchmark) surfaced as exit 0 with empty stdout. `ttlSec` still bounds command duration.
