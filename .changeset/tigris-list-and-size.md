---
"@computesdk/tigris": patch
---

Fix `list()` returning no objects (map the SDK's `items`/`hasMore`/`paginationToken` and pass `continuationToken` through), report UTF-8 byte size for string uploads, and pass credentials and bucket to the Tigris SDK per call instead of through `process.env`.
