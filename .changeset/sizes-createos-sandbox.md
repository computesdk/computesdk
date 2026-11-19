---
'@computesdk/createos-sandbox': patch
---

Add standard `sizeClass` support: xs–xl map to the smallest listed CreateOS shape that meets each profile (with the platform's disk sizes); 2xl/3xl, `shape`/`cpus`/`memoryMb` conflicts and sized snapshot restores are refused before any API call.
