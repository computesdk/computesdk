---
"@computesdk/createos-sandbox": patch
---

Native `instance.pause()`/`resume()` (waiting for the pause to settle before resuming), with declared `pauseCapabilities` and `snapshot.capabilities`: pause and snapshots keep the whole rootfs and running processes, and `snapshot.create` leaves the source running.
