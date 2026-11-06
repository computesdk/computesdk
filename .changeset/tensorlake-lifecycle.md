---
"@computesdk/tensorlake": patch
---

Native pause/resume through suspend/resume (`ephemeral: false` creates a uniquely named, suspendable sandbox), plus declared pause and snapshot capabilities with conformance coverage. `destroy()` now finds the sandbox's leftover `suspend-<id>-…` snapshots through the project-level snapshot list and deletes them, so they no longer leak after the sandbox is gone.
