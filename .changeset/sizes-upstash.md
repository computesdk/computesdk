---
'@computesdk/upstash': patch
---

Add the `sizeClass` resolver: `md`, `lg` and `xl` boot the Upstash Box `small`, `medium` and `large` sizes (with each tier's fixed disk in `resolved.diskMiB`) on every create path; `xs`, `sm`, `2xl` and `3xl` are `unsupported`.
