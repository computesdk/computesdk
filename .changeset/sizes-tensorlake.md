---
'@computesdk/tensorlake': patch
---

Support standard `sizeClass` sizes `xs` through `lg` at their exact CPU/RAM and `xl` at 8 vCPU / 16000 MB (`belowStandard`: Tensorlake caps sandbox RAM at 16000 MB; 384 MiB short, within the 10% memory tolerance), each with a 10240 MiB root disk. `2xl`, `3xl` and `sizeClass` with `snapshotId` are `unsupported`; native `cpus`/`memoryMb`/`diskMb`/`ephemeralDiskMb` conflict with `sizeClass`.
