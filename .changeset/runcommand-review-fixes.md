---
"@computesdk/beam": patch
"@computesdk/daytona": patch
---

Follow-up to the runCommand semantics fixes:

- **daytona**: the stderr-separator wrapper always exited 0, collapsing the real exit code — the real code is now emitted in-band and parsed back out.
- **beam**: `exec({wait: true})` blocks server-side until the command finishes, so the timeout timer started too late. The adapter now launches with `wait: false` when a timeout is requested and clears the timer once the process exits.
