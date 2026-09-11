---
"@computesdk/cloud-run": patch
---

Chunk `filesystem.writeFile` payloads (adapter and gateway) through a staging file so large writes no longer fail with `spawn E2BIG` from an oversized `/bin/sh -c` argument.
