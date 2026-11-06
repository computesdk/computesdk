---
"@computesdk/beam": patch
---

Resolve sandbox symlink targets rejected by Beam's download gateway before reading them through the native filesystem API. Preserve chunked large-file reads and add live snapshot-fidelity regression coverage.
