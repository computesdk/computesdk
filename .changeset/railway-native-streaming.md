---
'@computesdk/railway': patch
---

Stream command output natively through `sandbox.exec`, pass `env`/`cwd` through `sandbox.exec` so env reaches every part of a compound command, make command timeouts kill the process in the sandbox instead of only closing the client session, and retry execs whose session never opened.
