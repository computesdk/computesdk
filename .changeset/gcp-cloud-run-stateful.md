---
'@computesdk/gcp': patch
---

Cloud Run gateway: stateful sandboxes are real `sandbox run` sessions that exec and file calls reuse until destroy, with command exit codes preserved, in-sandbox deadlines, streamed exec output, rootfs snapshots (`sandbox tar` to GCS or the instance) with restore via `create({ snapshotId })`, fork, and idle cleanup. The provider adds `snapshot` methods with rootfs capabilities proven against a deployed gateway, native streaming, session-affinity routing, and keeps working against older gateways. Setup can create a snapshot bucket and grant its IAM role, reuses `CLOUD_RUN_SANDBOX_SECRET` when set, installs CA certificates for `gs://` snapshots, passes `CLOUD_RUN_SANDBOX_IDLE_TIMEOUT_MS` through and routes traffic to the new revision.
