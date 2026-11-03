---
"@computesdk/e2b": patch
---

Stop reporting failed sandbox lookup and deletion requests as absence or success.
Check existence with the native metadata API, accept only its typed sandbox-not-found
error as absence, and propagate connection failures. Positive lookup still uses
the existing public connect API, which can resume paused sandboxes or renew their
timeout. Delete directly without reconnecting, preserving native boolean
not-found semantics and rejecting malformed completion results.
