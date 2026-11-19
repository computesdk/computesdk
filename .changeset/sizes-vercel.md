---
'@computesdk/vercel': patch
---

Add a standard-size resolver: every `sizeClass` maps to `resources.vcpus` (`xs` and `sm` 1, then 2/4/8/16/32; 2048 MiB RAM per vCPU, 64 GiB disk, 32 GiB on a deprecated `runtime`), and combining `sizeClass` with native `resources` is a conflict.
