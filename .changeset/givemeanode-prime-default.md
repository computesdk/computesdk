---
"@computesdk/givemeanode": minor
---

`fastToken` now defaults to `prime`: one cheap, single-flighted warm-up request per process, so even the first creates of a burst present the signed credential instead of each paying the authentication read. Pass `fastToken: 'absorb'` to keep the previous behaviour (no extra request; the first request pays the ordinary cost).
