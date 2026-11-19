---
'@computesdk/superserve': patch
---

Add a `sizeClass` resolver: `xs`–`2xl` boot per-size templates (`md` is the built-in `superserve/base`, the others `csdk-node22-<vcpus>cpu-<GiB>gb` team templates, overridable with `sizeTemplates`). `3xl` is `unsupported` (Superserve lists at most 16 vCPU / 64 GiB). Native `vcpu`/`memoryMib`/`diskMib` with `sizeClass` is a conflict; a missing size template fails with setup guidance.
