---
"@computesdk/archil": minor
---

Refine Archil sandbox API to strict disk-id semantics.

- `create()` now requires a top-level `diskId` option (no metadata wrapper).
- `getById()` now resolves strictly by disk id (no name fallback).
- Docs/tests updated to match the stricter Archil contract.
