---
"@computesdk/vercel": patch
---

Default `persistent` to `false` when creating Vercel sandboxes. Vercel sandboxes are persistent by default, so every `stop()` auto-snapshots the filesystem and accrues Snapshot Storage — ComputeSDK callers now get non-persistent sandboxes unless they pass `persistent: true` in create options.
