---
"@computesdk/aws": patch
---

EC2: return full command output without S3. Output past SSM's 24,000-character inline limit is spilled to files on the instance and read back in chunks, capped per stream by the new `maxOutputBytes` (default 4 MiB). `outputS3Bucket` remains the fast path.
