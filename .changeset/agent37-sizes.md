---
'@computesdk/agent37': patch
---

Declare standard sizes: `sizeClass` `md` (2 vCPU / 4 GB) and `lg` (4 vCPU / 8 GB) map onto `resources` on create. `xs`, `sm`, `xl` and `2xl` fail with `unsupported`, since Agent37 only offers 2/4, 4/8, 4/16 and 4/32 shapes with a 4 vCPU ceiling.
