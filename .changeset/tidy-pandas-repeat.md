---
"@computesdk/tensorlake": patch
---

Fix `getUrl` returning unusable preview URLs: build the URL on `sandbox.tensorlake.ai` (swapping `api.` → `sandbox.` in the API hostname) instead of the API host, and register the port in `exposed_ports` with `allow_unauthenticated_access` before returning so the URL is publicly reachable.
