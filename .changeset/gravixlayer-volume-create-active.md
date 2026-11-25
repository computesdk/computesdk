---
"@computesdk/gravixlayer": patch
---

`volume.create` now waits for the backing bucket to reach `active` before returning. Buckets come back `provisioning` and stay unmountable for a short window, so a `volume.create` → `sandbox.volumes.mount` sequence raced and failed with `bucket not active`. The wait is bounded (60s) and throws on terminal statuses (`failed`, `error`, `deleted`) instead of polling forever.
