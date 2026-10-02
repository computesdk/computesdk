---
"@computesdk/miosa": patch
---

Dispatch each request to the least-loaded ready HTTP/2 session, honoring that session's own advertised concurrent-stream limit, instead of rotating blindly across every ready session. A burst now spreads across sessions as they come online rather than piling onto whichever session connected first, and only waits when every ready session is already at its own stream cap.
