---
"@computesdk/uno": patch
---

Notice a new sandbox as soon as it is ready: poll its status every 100 ms for the first 10 s, then once a second, instead of backing off 250 ms → 2 s. The interval counts from the start of each request, so the round trip no longer adds to the wait.
