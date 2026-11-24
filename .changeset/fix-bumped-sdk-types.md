---
"@computesdk/blaxel": patch
"@computesdk/r2": patch
"@computesdk/s3": patch
---

Adapt to the bumped provider SDKs:

- @computesdk/blaxel: `@blaxel/core` 0.3.41 returns paginated image summaries — tags moved to `listImageTags`, so template listing and build polling page those endpoints instead of reading `spec.tags`.
- @computesdk/r2, @computesdk/s3: `@tigrisdata/storage` 3.25 added `includeMetadata` `get` overloads — the download call now pins the bare-stream overload so `result.data` stays a `ReadableStream`.
