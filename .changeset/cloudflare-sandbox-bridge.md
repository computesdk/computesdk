---
"@computesdk/cloudflare": patch
---

Update the Cloudflare provider remote mode to use the official Cloudflare Sandbox bridge API. New remote deployments no longer require a ComputeSDK-specific gateway Worker; deploy Cloudflare's reference bridge Worker and configure `sandboxUrl` with `sandboxApiKey`. The previous `sandboxSecret` option remains as a deprecated alias for `sandboxApiKey`.

Direct mode can now opt in to the official bridge WarmPool by passing `warmPool: { binding, target, refreshInterval }` alongside `sandboxBinding`.
