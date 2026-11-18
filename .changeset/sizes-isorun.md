---
'@computesdk/isorun': patch
---

Add a standard `sizeClass` resolver: `xs`, `md`, `lg` and `xl` map to Isorun's listed 1/1, 2/4, 4/8 and 8/16 GiB shapes (md–xl with 16/32/64 GiB disk); `sm`, `2xl` and `3xl` are `unsupported`, and `snapshotId` with `sizeClass` is refused.
