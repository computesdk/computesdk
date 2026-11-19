---
'@computesdk/miosa': patch
---

Map standard `sizeClass` requests onto MIOSA's named sandbox sizes (`xs` and `sm`→`xs`, `md`→`small`, `lg`→`medium`, `xl`→`large`, `2xl`→`xl`, with each size's fixed disk in `resolved`), refuse `3xl` and snapshot restores, reject conflicting native size/CPU/memory/disk fields, and forward a native `size` option to the create request.
