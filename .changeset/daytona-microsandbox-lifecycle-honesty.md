---
"@computesdk/daytona": patch
"@computesdk/microsandbox": patch
---

Validate canonical native identities and propagate lookup/deletion failures.
Daytona no longer guesses absence from public-get 404 errors, which can come
from auxiliary toolbox metadata after a successful sandbox lookup. Microsandbox
uses its documented native database-not-found discriminator only around the
initial handle lookup. Preserve native void-return acknowledgement semantics and
existing connection, startup and cleanup-retry behavior without claiming remote
physical deletion from persisted metadata.
