---
'@computesdk/buddy': patch
---

Expose `stop()` and `start()` on the sandbox handle returned by `getInstance()`, so a Buddy sandbox can be stopped and started again under the same id with its disk preserved.
