---
"@computesdk/tensorlake": patch
---

Fix `timeout` unit mismatch in the Tensorlake provider. `config.timeout` (passed to `tensorlake({ timeout: ... })`) was being forwarded to the underlying SDK as seconds while `options.timeout` (passed to `compute.sandbox.create({ timeout: ... })`) was correctly treated as milliseconds, contradicting the `TensorlakeConfig` interface comment. Both inputs are now consistently milliseconds and converted to seconds at the SDK boundary, matching the convention used by every other ComputeSDK provider.
