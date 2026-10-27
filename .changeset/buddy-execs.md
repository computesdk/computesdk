---
'@computesdk/buddy': patch
---

Run timed, streaming and background commands through Buddy's `execs` resource (`@buddy-works/sandbox-sdk` 0.3.0), which replaces the removed `commands` endpoints. The execs log does not separate stdout from stderr, so that output now arrives on `stdout` / `onStdout` only. Buddy's concurrency limit (HTTP 409) surfaces as an error that says what to do.
