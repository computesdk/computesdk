---
'@computesdk/gcp': patch
---

Fix Cloud Run gateway snapshot listing and deletion to use the documented default service-account token metadata endpoint instead of a nonexistent path.

Attempt bounded cleanup of failed and timed-out stateful creates/restores only for gateway-allocated IDs, preserving the original error and leaving caller-supplied IDs untouched. SDK auto-create delegates ID allocation to the gateway so it can establish cleanup ownership. Redeploy the gateway to apply these fixes.
