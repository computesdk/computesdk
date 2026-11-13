---
"@computesdk/uno": patch
---

Create a sandbox in one request: `create` asks the API to hold its answer until the machine is ready (`wait_ready_s`, up to 30 s within `readyTimeoutMs`) and no longer polls when it is. If create comes back still starting (an older API, or a wait cut short), readiness is polled as before, now every 100 ms for the first 10 s, then once a second, instead of backing off 250 ms → 2 s; the interval counts from the start of each request, so the round trip no longer adds to the wait.
