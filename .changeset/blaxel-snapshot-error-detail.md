---
'@computesdk/blaxel': patch
---

Fix `snapshot.create` surfacing `Failed to create Blaxel snapshot: [object Object]` — `@blaxel/core` requests use `throwOnError`, so rejections can be plain API error objects. The catch now serializes non-`Error` throwables with `JSON.stringify` (same pattern used in sandbox create) so the real error is visible.
