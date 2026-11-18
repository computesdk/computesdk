---
'@computesdk/daytona': patch
---

Support `sizeClass` on Daytona: `xs`, `sm`, `md` and `lg` boot an image with the exact standard CPU/RAM (plus the platform disk for `sm`–`lg`); `xl` and larger are refused above Daytona's 4 vCPU / 8 GiB sandbox limit. Add the `sizeImage` config option.
