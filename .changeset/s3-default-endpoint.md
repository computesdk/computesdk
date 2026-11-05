---
"@computesdk/s3": patch
---

Fix `list()` returning no objects: read the Tigris SDK's `items`/`name`/`hasMore`/`paginationToken` response and pass `continuationToken` as `paginationToken`. Default the endpoint to Tigris (`https://t3.storage.dev`, like the Tigris SDK) when neither `endpoint` nor `TIGRIS_STORAGE_ENDPOINT` is set, instead of throwing.
