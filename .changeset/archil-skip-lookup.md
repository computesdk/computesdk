---
"@computesdk/archil": patch
---

perf(archil): skip disk lookup on create

`provider.sandbox.create()` no longer fetches the disk before returning, and `getInfo()` derives metadata from the disk handle when full disk metadata is not available.
