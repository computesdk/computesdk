---
'@computesdk/railway': patch
---

Stream command output natively through `sandbox.exec`, and make command timeouts kill the process in the sandbox instead of only closing the client session.
