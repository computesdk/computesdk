---
"computesdk": minor
---

Update gateway provider to use plural `/v1/sandboxes` endpoints for REST consistency

- `POST /v1/sandboxes` - Create a new sandbox
- `GET /v1/sandboxes/:id` - Get sandbox info
- `DELETE /v1/sandboxes/:id` - Destroy sandbox
- `POST /v1/sandboxes/:id/extend` - Extend sandbox expiration
- `POST /v1/sandboxes/find-or-create` - Find or create by namespace/name
- `POST /v1/sandboxes/find` - Find by namespace/name

**Breaking Change:** Requires gateway version with plural endpoints (computesdk/edge#80)
