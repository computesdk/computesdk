---
'@computesdk/northflank': patch
---

Reuse TCP/TLS connections by passing a shared keepAlive HTTP(S) agent to the Northflank API client and WebSocket exec upgrade, reducing per-request handshake overhead under high request volume.
