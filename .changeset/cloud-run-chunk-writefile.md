---
"@computesdk/cloud-run": patch
---

Pipe `filesystem.writeFile` content to the sandbox CLI via stdin (adapter and gateway) so large writes no longer fail with `spawn E2BIG` from an oversized `/bin/sh -c` argument.
