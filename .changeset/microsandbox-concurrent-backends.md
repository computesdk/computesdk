---
"@computesdk/microsandbox": patch
---

Allow concurrent operations using identical backend selections while preserving isolation and FIFO ordering across different credentials. Accept memoryMib and rootDiskMib in sandbox create options so requested resources are not silently replaced by defaults.
