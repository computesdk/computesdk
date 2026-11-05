---
'@computesdk/upstash': patch
---

Pass absolute file paths (e.g. `/tmp`) through unchanged, follow symlinks in `readFile`, chunk files larger than the files API payload limit, report raw stdout for failing commands, and implement `snapshot.delete` via `Box.deleteSnapshots`.
