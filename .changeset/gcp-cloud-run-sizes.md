---
'@computesdk/gcp': patch
---

Cloud Run: support `sizeClass` (`xs` to `xl`) by routing each size to a gateway service deployed at that CPU and memory. Configure these with `sizeGateways` or `CLOUD_RUN_SANDBOX_URL_<SIZE>`, and deploy them with `CLOUD_RUN_SIZE=<size>` setup. The gateway reports its size in `/v1/health`. An unconfigured or mismatched size, or `2xl`, fails instead of running another size.
