---
'@computesdk/vercel': patch
---

Add a standard-size resolver: `sizeClass` `sm`, `md`, `lg`, `xl` and `2xl` map to `resources.vcpus` 1/2/4/8/16 (2048 MiB RAM per vCPU, 64 GiB disk, 32 GiB on a deprecated `runtime`). `xs` and `3xl` are `unsupported`, and combining `sizeClass` with native `resources` is a conflict.
