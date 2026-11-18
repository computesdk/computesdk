---
"computesdk": patch
---

The `platform` provider now forwards `type` to `POST /api/v1/sandboxes`, so adapters with an instance-type concept (Agent37 `default` | `performance` | `vm`) can be driven through the platform.
