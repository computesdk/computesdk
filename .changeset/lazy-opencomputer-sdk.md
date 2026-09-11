---
"@computesdk/opencomputer": patch
---

Load the OpenComputer SDK on first provider use. Importing an unused provider no longer changes the global HTTP dispatcher or starts background connections. Concurrent operations share one SDK initialization.
