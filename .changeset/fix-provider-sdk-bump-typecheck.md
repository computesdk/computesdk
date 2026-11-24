---
"@computesdk/blaxel": patch
"@computesdk/r2": patch
"@computesdk/s3": patch
---

Fix the build after the provider SDK bump: Blaxel templates read the paginated image catalog (`Blaxel-Version` 2026-09-22) and fetch tags with `listImageTags`; R2 and S3 downloads resolve the plain stream `get` overload of `@tigrisdata/storage` 3.25.
