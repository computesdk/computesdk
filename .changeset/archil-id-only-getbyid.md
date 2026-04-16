---
"@computesdk/archil": minor
---

Refine Archil sandbox lookup semantics to be ID-only.

- `create()` now requires an existing disk id in `metadata.diskId` and no longer provisions/deletes disks.
- `getById()` now resolves disks strictly by disk ID.
- Removed fallback behavior that treated `getById()` input as a disk name.
- Updated docs and tests to reflect the stricter contract.
