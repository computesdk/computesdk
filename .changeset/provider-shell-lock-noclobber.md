---
"@computesdk/provider": patch
---

Shell process tier: lock log appends with a noclobber file create instead of `mkdir`, which is not atomic under uutils coreutils (Ubuntu 26.04 images).
