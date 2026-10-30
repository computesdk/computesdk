---
"@computesdk/gcp": patch
---

fix(gcp/cloud-run): chunk writeFile payloads into a staging file so a single `/bin/sh -c` argument stays under the kernel's MAX_ARG_STRLEN (spawn E2BIG on files >~96KB)
