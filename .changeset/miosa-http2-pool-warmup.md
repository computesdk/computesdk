---
"@computesdk/miosa": patch
---

fix(miosa): don't block requests on HTTP/2 pool warm-up

A request made before any pooled HTTP/2 session was ready waited for the first
session and then for 8 of the 16 sessions to connect, polling for up to 250 ms,
even though one ready session can serve it. Requests now dispatch as soon as
the first session is ready; sessions that become ready later join the rotation.
The bounded first-connect wait and the fallback for an endpoint that never
connects are unchanged.

Dispatch now also honors each session's SETTINGS_MAX_CONCURRENT_STREAMS. A
session counts as ready once the peer's SETTINGS have arrived, requests go
round-robin to ready sessions with spare stream capacity, and when every ready
session is at its limit a request waits until a stream closes or another
session becomes ready, instead of opening a stream the server would refuse.
