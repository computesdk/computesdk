---
"@computesdk/lelantos": patch
---

Surface the underlying network error (e.g. `ECONNREFUSED`) instead of a bare `fetch failed` when sandbox creation or a command cannot reach the Lelantos control plane.
