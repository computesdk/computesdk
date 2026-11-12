---
"@computesdk/freestyle": patch
---

Reject CPU or memory requests below the boot snapshot's resources instead of silently returning a larger VM, and honor environment-selected snapshots when checking standard size availability.
