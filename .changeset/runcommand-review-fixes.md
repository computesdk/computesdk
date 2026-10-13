---
"@computesdk/beam": patch
"@computesdk/daytona": patch
"@computesdk/codesandbox": patch
---

Follow-up to the runCommand semantics fixes:

- **daytona**: the stderr-separator wrapper always exited 0, collapsing the real exit code — the real code is now emitted in-band and parsed back out.
- **beam**: `exec({wait: true})` blocks server-side until the command finishes, so the timeout timer started too late. The adapter now launches with `wait: false` when a timeout is requested, starts the deadline clock before the launch call, clears the timer once the process exits, and reports exit code 124 on timeout instead of 0.
- **daytona, codesandbox**: in-band delimiters are now unique per call so command output containing the marker text can't mask the real delimiter.
