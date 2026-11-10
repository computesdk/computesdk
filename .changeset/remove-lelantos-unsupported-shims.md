---
"@computesdk/lelantos": patch
---

Remove unsupported snapshot list/delete shims and the unsupported template manager. Snapshot list/delete now reject with an unsupported-operation error instead of returning empty results or silently succeeding; snapshot creation and restore remain supported.
