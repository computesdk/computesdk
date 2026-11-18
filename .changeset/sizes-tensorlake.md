---
'@computesdk/tensorlake': patch
---

Support standard `sizeClass` sizes `xs` through `2xl` at their exact CPU/RAM with a 10240 MiB root disk; `3xl` and snapshot restores are `unsupported`, and native `cpus`/`memoryMb`/`diskMb`/`ephemeralDiskMb` conflict with `sizeClass`.
