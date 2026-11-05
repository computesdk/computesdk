---
'@computesdk/provider': patch
---

`getById` only reattaches egress info when the provider has a native filesystem, so providers on the shell filesystem fallback don't run commands on every lookup.
