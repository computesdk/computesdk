---
'@computesdk/sail': patch
---

Map standard sizes `sm` through `3xl` to Sailbox `vcpuCount` and memory limits (memory is at least 16 GiB, Sail's minimum), refuse `xs`, and forward a native `vcpuCount` create option.
