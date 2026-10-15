---
"@computesdk/namespace": patch
---

Namespace API errors now include Namespace's error body, and transient failures retry: any call when the connection never opened, idempotent calls (describe/list/destroy) on any 5xx or dropped connection. Not-found detection keys on the response status, not a `404` in the message.
