---
'@computesdk/blaxel': patch
---

Map standard sizes `sm`, `md` and `lg` to Blaxel `memory` (2048/4096/8192 MB). `xs` is `unsupported`; `xl`, `2xl` and `3xl` are `unknown` because Blaxel's docs disagree on CPU from 16 GB up. `sizeClass` is refused with `memory` (conflict), `snapshotId` or `sandboxId`.
