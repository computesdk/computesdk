---
'@computesdk/gravixlayer': patch
---

Snapshots now default to `hot` (filesystem and memory), so `/tmp` contents are restored. Pass `metadata: { kind: 'cold' }` for a filesystem-only snapshot.
