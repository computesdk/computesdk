---
'@computesdk/mosaic': patch
---

Forward `memoryMb`/`vcpu` in `template.create` so sized environments (e.g. the 16384 MiB / 8 vCPU build shape) can be built through the SDK. The gateway validates the pair against the supported shapes published by `GET /v1/limits`.
