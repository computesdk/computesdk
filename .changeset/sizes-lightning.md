---
'@computesdk/lightning': patch
---

Map standard sizes to Lightning instance types: `xs` → `cpu-1`, `md` → `cpu-2`, `lg` → `cpu-4`, `xl` → `cpu-8`, `2xl` → `cpu-16` (resolved with the listed RAM and default disk). `sm` and `3xl` are `unsupported`. A per-create `instanceType` now overrides `config.instanceType` instead of being dropped.
