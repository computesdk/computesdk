---
"@computesdk/namespace": patch
---

Namespace API errors now include Namespace's error body, and transient failures retry: any call on 503 or a connection that never opened, idempotent calls (describe/list/destroy) on any 5xx or dropped connection.
