---
"@computesdk/cloudflare": patch
---

Add a ComputeSDK bridge Worker for Cloudflare Containers with native file transfer, preview URLs and filesystem snapshots (declared in `snapshot.capabilities`). The adapter detects the bridge via `GET /v1/info` and keeps working unchanged against the Cloudflare sandbox demo Worker.
