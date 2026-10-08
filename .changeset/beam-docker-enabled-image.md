---
'@computesdk/beam': patch
---

Boot the default `node:24` image with beam-js `withDocker()` when `dockerEnabled` is requested — `dockerEnabled` alone cannot schedule a sandbox on an image without Docker.
