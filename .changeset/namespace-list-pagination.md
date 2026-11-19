---
"@computesdk/namespace": patch
---

Follow list pagination so listings are not truncated to the first page. Namespace's Connect JSON returns list pages with a lowerCamelCase `paginationCursor`, but the adapter read only `pagination_cursor`, so the cursor was always dropped: `instances.list`, `volume.list`, `snapshot.list` and the per-tag snapshot records each returned just their first page. `instances.list` also never sent the cursor at all. Listings now page through `paginationCursor` (the proto `pagination_cursor` name is still accepted) and stop if the server repeats a cursor.
