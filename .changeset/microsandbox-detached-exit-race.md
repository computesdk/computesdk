---
"@computesdk/microsandbox": patch
---

A detached command that finishes between the status probe's exit-sentinel check and its liveness check is now reported as complete instead of failing with "detached command died before completing". The probe re-reads the exit sentinel after finding the worker gone.
