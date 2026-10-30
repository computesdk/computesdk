---
"@computesdk/miosa": patch
---

Snapshot calls on regionally-created sandboxes now fail with an actionable error naming the cause and remedy (snapshots are account-API only; recreate the sandbox with `runnerMode: false` or `MIOSA_RUNNER_MODE=0`) instead of a bare `404 NOT_FOUND` from `POST /sandboxes/:id/snapshots`.
