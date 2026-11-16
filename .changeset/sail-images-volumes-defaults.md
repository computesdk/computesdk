---
"@computesdk/sail": patch
---

Update the Sail SDK to 0.18.2 and expose OCI image creates, environment variables,
hard lifetimes, and persistent volume lifecycle/mounts. Stop forcing the legacy
small size: creates inherit image resource limits (8 vCPUs by default). Removed
`size`/`memoryGib` options now report migration guidance; configure resources on
the Sail Image instead.
