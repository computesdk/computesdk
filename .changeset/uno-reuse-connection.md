---
"@computesdk/uno": patch
---

Keep a sandbox's API calls on one connection: each request now waits one timer tick so the previous response's socket is back in the pool. Without it, Node's `fetch` opened a second connection for a call made right after the previous one, which could reach the API through a different edge server with a cold link to the origin (about +0.2 s).
