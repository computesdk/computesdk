---
"@computesdk/microsandbox": patch
---

Allow concurrent operations using identical backend selections while preserving isolation and FIFO ordering across different credentials. Accept memoryMib and rootDiskMib in sandbox create options so requested resources are not silently replaced by defaults. Report failed cleanup of cancelled sandbox creation. Require Microsandbox SDK 0.6.18 or newer within the 0.6 release line. Default to ephemeral sandboxes with a 15-minute lifetime; support explicit persistent and lifetime overrides.
