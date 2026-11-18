---
"computesdk": patch
"@computesdk/agent37": patch
---

Add `public`/`label` options to `getUrl`: `getUrl({ port, public: true })` returns a permanent, unauthenticated port URL (Agent37 public ports) instead of the provider's ephemeral signed URL. The platform router forwards it via `POST /api/v1/sandboxes/{id}/urls`.
