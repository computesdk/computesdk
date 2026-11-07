---
'@computesdk/gcp': patch
---

Fix Cloud Run gateway snapshot listing and deletion to use the documented default service-account token metadata endpoint instead of a nonexistent path.

Attempt bounded cleanup of failed and timed-out stateful creates/restores while preserving the original error and protecting existing same-name sandboxes. Redeploy the gateway to apply these fixes.
