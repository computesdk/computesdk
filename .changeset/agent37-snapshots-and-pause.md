---
"@computesdk/agent37": patch
---

Adds pause/resume and snapshots to the Agent37 adapter. `pause`/`resume` map to the API's `POST /v1/instances/{id}/stop` and `/start` pair (box-identity pause; disk survives, memory does not). Snapshots use `POST /v1/instances/{id}/fork`: `snapshot.create` forks the source into an independent tagged instance, `create({ snapshotId })` forks that artifact into a fresh sandbox (one snapshot restores many boxes), and `snapshot.delete` destroys it.
