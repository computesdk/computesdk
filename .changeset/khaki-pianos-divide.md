---
'@computesdk/s3': minor
'@computesdk/r2': minor
'@computesdk/tigris': patch
'@computesdk/browseruse': patch
---

Migrate S3 and R2 providers from direct AWS SDK usage to `@tigrisdata/storage`, including per-call config forwarding and improved object metadata handling on downloads.

Align Tigris storage dependency usage across providers and include a BrowserUse typing fix for custom proxy configuration.
