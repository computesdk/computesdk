---
'@computesdk/cloudflare': patch
---

Move file contents in larger, parallel chunks: writes pack several base64 arguments into each exec and write them at their offsets, and reads are split into 4 MiB ranges so large files no longer exceed exec output limits. Fix the getById unit test for the egress reattach read and add a credential-gated live test.
