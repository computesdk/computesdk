---
'@computesdk/sprites': patch
---

Declare standard sizes for Sprites: every `sizeClass` is `unsupported` because Sprites run on one fixed shape (8 vCPUs, platform-managed memory, 100 GB storage) and the create API takes no CPU, memory or disk fields. `create({ sizeClass })` now fails with `InstanceSizeError` instead of booting the fixed shape.
