---
'@computesdk/modal': patch
---

Map every standard `sizeClass` (`xs` through `3xl`) to Modal's `cpu`/`cpuLimit` (physical cores, 1 core = 2 vCPUs) and `memoryMiB`/`memoryLimitMiB`, with the fixed 512 GiB sandbox disk in `resolved.diskMiB`. Conflicting native CPU/memory fields are rejected, and a VM sidecar memory reserve is `unsupported`.
