---
"@computesdk/vercel": minor
---

Add support for Vercel Sandbox snapshots:
- Implement `snapshot.create()` and `snapshot.delete()`.
- Support creating new sandboxes from snapshots via `sandbox.create({ snapshotId: '...' })`.
