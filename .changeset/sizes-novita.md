---
'@computesdk/novita': patch
---

Add standard `sizeClass` support: `xs`, `sm`, `md` and `lg` boot per-size `csdk-node22-*` account templates (override with `sizeTemplates`) and report Novita's fixed 20 GB disk. `xl`, `2xl` and `3xl` are `unsupported` (8 vCPU / 8 GiB cap). Native `cpuCount`/`memoryMB`/`build` with `sizeClass` is a `conflict`.
