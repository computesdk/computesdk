---
'@computesdk/cloudflare': patch
---

Map standard sizes `xs` through `lg` to exact Cloudflare custom instance types (`vcpu`/`memoryMib`/`diskMb`); `xl` and larger are `unsupported` past the 4 vCPU / 12 GiB per-instance limit.
