---
'@computesdk/tenki': patch
---

Add the standard `sizeClass` mapping: every size from `xs` to `3xl` maps to exact per-create `cpuCores` / `memoryMb`, with the platform's 5/10/20/40 GiB root disk for `sm`–`xl`. Native `cpuCores`/`memoryMb` with `sizeClass` is a conflict, and `snapshotId` restores are `unknown`.
