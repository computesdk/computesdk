---
"@computesdk/givemeanode": minor
---

One HTTP/2 session per provider on Node, opened (with the `prime`) when the provider is constructed, every request a stream on it. A burst of 100 concurrent creates over `fetch` opened 100 TLS connections whose handshakes ran one after another on the one thread; over one session the same burst measured a 40 ms median time-to-interactive against 211 ms, from us-east-1. `fetch` stays the fallback where `node:http2` is missing or a session cannot be opened, and is selected by an injected `fetch`; `transport: 'fetch' | 'http2' | 'auto'` chooses explicitly.
