---
"@computesdk/aws": patch
---

EC2: fix large stderr being cut to SSM's 8,000-character stderr limit (spill threshold and S3 fallback now use it, and read-back chunks always come back on stdout); remove spilled output files when a command is cancelled at the client deadline.
