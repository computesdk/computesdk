---
'@computesdk/sail': patch
---

Map every standard size to Sailbox `vcpuCount` and memory limits (memory is at least 16 GiB, Sail's minimum, so `xs` is 1 vCPU / 16 GiB), and forward a native `vcpuCount` create option.
