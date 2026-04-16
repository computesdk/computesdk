---
"@computesdk/upstash": minor
---

Add ephemeral box option to Upstash create and improve sandbox typing.

- `create()` now accepts an optional `ephemeral` flag for non-persistent boxes.
- Ephemeral mode is honored during snapshot restores.
- Narrow sandbox typing for box variants with exported native type guards.
