---
"@computesdk/modal": patch
---

Remove the unsupported snapshot listing shim. Snapshot listing now rejects with an unsupported-operation error instead of returning an empty list, and snapshot operations metadata correctly reports listing as unsupported. Snapshot creation, deletion, and restoration remain supported.
