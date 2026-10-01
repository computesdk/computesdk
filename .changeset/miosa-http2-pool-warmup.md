---
"@computesdk/miosa": patch
---

fix(miosa): don't block requests on HTTP/2 pool warm-up

A request made before any pooled HTTP/2 session had connected waited for the
first session and then for 8 of the 16 sessions to connect, polling for up to
250 ms, even though one connected session can serve it. Requests now dispatch
as soon as the first session connects; sessions that connect later join the
round-robin. The bounded first-connect wait and the fallback for an endpoint
that never connects are unchanged.
