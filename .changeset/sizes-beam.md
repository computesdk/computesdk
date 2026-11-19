---
'@computesdk/beam': patch
---

Map every standard `sizeClass` (`xs` through `3xl`) to its exact Beam `cpu`/`memory`. Native `cpu`/`memory` with `sizeClass` is a conflict; snapshot restores and sandbox attaches are unsupported; the Shared CPU tier refuses `2xl`/`3xl`; GPU and pool placement are unknown.
