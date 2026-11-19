---
'@computesdk/blaxel': patch
---

Map standard sizes `xs`, `sm`, `md` and `lg` to Blaxel `memory` (2048/2048/4096/8192 MB; `xs` takes 2048 MB for a whole core); `xl`, `2xl` and `3xl` are `unknown` because Blaxel's docs disagree on CPU from 16 GB up. `sizeClass` is refused with `memory` (conflict), `snapshotId` or `sandboxId`.
