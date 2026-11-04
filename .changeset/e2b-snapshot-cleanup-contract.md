---
"@computesdk/e2b": patch
---

Use the native snapshot listing and deletion APIs rather than silently returning empty inventory or skipping cleanup.

Listing follows native pagination and preserves snapshot IDs, source filtering, and a total result limit. Native listing and deletion failures propagate instead of being reported as success. No creation timestamp is invented when the native API does not provide one.

Existing template list/delete operations now fail explicitly when their legacy native hooks are unavailable, and propagate hook failures rather than reporting empty inventory or successful cleanup. No new template builder or snapshot/template alias is introduced.
