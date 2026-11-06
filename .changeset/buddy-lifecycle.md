---
'@computesdk/buddy': patch
---

Sandboxes expose `pause()`/`resume()`, which stop the sandbox and start the same one again with its disk kept (except `/tmp`, cleared on boot; processes are not kept). `buddy.sandbox.pause` declares `{ memory: false }` and `buddy.snapshot.capabilities` declares root-filesystem snapshots that leave the source running. `getInstance().stop()`/`start()` keep working.
