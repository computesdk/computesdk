---
'@computesdk/leap0': patch
---

Map standard sizes `xs`, `sm`, `md` and `lg` to Leap0's native `vcpu`/`memory` (fixed 10 GiB disk reported in `resolved.diskMiB`). `xl`, `2xl` and `3xl` exceed Leap0's 8 vCPU / 8192 MiB limit and are `unsupported`, as is `sizeClass` with `snapshotId`; native `vcpu`/`memory` with `sizeClass` is a `conflict`.
