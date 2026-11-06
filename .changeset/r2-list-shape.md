---
"@computesdk/r2": patch
---

`list()` reads the storage SDK's `items`/`hasMore`/`paginationToken` response, so listed objects, truncation and continuation tokens are no longer dropped.
