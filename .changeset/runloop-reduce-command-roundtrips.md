---
"@computesdk/runloop": patch
---

Reduce Runloop provider round trips by reusing the SDK client, using long-poll waits, and enabling optimistic command completion.
