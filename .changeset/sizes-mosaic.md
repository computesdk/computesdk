---
'@computesdk/mosaic': patch
---

Map standard sizes for Mosaic: `sm`-`2xl` boot their exact `vcpu`/`memory_mb` shape (`xl`/`2xl` on template `base`), `xs` boots the 1 vCPU / 1 GiB environment `csdk-node22-1cpu-1gb` (override with `sizeTemplates`), and `3xl` is unsupported.
