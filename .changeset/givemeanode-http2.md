---
"@computesdk/givemeanode": minor
---

One HTTP/2 session per provider on Node, opened when the provider is constructed (nothing is sent on it until the first operation; `warm: 'prime'` pays the fast-token prime up front as well), every request a stream on it. An idle session does not keep the process alive, and `GmnClient.close()` lets it go. A burst of 100 concurrent creates over `fetch` opened 100 TLS connections whose handshakes ran one after another on the one thread; over one session the same burst measured a 40 ms median time-to-interactive against 211 ms, from us-east-1. `fetch` stays the fallback where `node:http2` is missing or a session cannot be opened, and is selected by an injected `fetch`; `transport: 'fetch' | 'http2' | 'auto'` chooses explicitly.

`fastToken` defaults to `absorb` again: the door has answered a `gmnt_` token from memory since the day `prime` became the default, and the prime itself is a workspace listing that crosses to the database (113 to 140 ms). Measured from us-east-1 at 100 concurrent creates over one session, 56 to 106 ms median time-to-interactive with no prime against 166 ms waiting on one. `warm: 'prime'` and `fastToken: 'prime'` keep the warm-up for callers who want it.
