---
'@computesdk/givemeanode': patch
---

Split `filesystem.writeFile` content larger than one exec can carry into appended slices (the exec channel voided any command over ~112 KiB with `exec_channel_lost`), and report voided/cancelled exec results with their cause instead of a generic failure.
