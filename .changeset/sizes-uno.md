---
"@computesdk/uno": patch
---

Uno: `create({ sizeClass })` maps every standard size (`xs`–`3xl`) to its exact vCPU/RAM, with the platform's 10/20/40/80 GiB disk on `sm`–`xl`; refuses native CPU/RAM/disk fields and `snapshotId` alongside it.
