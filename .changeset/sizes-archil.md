---
'@computesdk/archil': patch
---

Archil `sizeClass` now maps `xs` (1 vCPU / 1 GiB) and `2xl` (16 vCPU / 32 GiB) in addition to `sm`–`xl`, using exact `vcpus`/`memoryMiB`. `3xl` is `unsupported`: Archil sandboxes cap memory at 64 GiB.
