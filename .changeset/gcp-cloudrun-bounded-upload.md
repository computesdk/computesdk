---
"@computesdk/gcp": patch
---

Bound oversized stateful Cloud Run file uploads by serialized JSON bytes using existing gateway routes, with isolated staging, checked replacement and cleanup. Reject oversized ephemeral writes explicitly and preserve non-JSON gateway error details.
