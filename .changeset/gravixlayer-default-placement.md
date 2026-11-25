---
"@computesdk/gravixlayer": patch
---

Bump `gravixlayer` to ^0.1.53. Default placement changes from `aws` / `us-east-1` to `gravix` / `us-central-1` when `cloud`/`region` (or `GRAVIXLAYER_CLOUD`/`GRAVIXLAYER_REGION`) are not set. Set them explicitly to keep the previous placement. Docs and test fixtures updated to match.
