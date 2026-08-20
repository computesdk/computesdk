---
"@computesdk/miosa": patch
---

Implement snapshot deletion: resolve the owning sandbox from an in-process index populated by create/list, falling back to scanning the caller's sandboxes; idempotent on unknown or already-deleted snapshots
