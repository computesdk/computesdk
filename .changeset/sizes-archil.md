---
'@computesdk/archil': patch
---

Archil `sizeClass` now maps `xs` (1 vCPU / 1 GiB), `2xl` (16 vCPU / 32 GiB) and `3xl` (32 vCPU / 64 GiB) in addition to `sm`–`xl`, using exact `vcpus`/`memoryMiB`. `3xl` maps to 32 vCPU / 64 GiB, Archil's maximum.
