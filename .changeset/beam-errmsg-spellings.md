---
'@computesdk/beam': patch
---

Read `err_msg`/`error_msg` alongside the camelCase spellings from beam gateway error bodies so an attached-state error reaches `withVolumeSettle`'s retry check instead of collapsing to the generic message.
