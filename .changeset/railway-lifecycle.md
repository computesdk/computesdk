---
'@computesdk/railway': patch
---

Declare snapshot capabilities: a Railway checkpoint keeps the whole root filesystem (including `/tmp`, not `/dev/shm`), boots restores fresh without running processes, and leaves the source running; the conformance suite now runs snapshot tests live. An exec whose WebSocket never opened is retried even when its timeout fired while connecting.
