---
"@computesdk/microsandbox": patch
---

Fail fast when a detached command never starts. The status probe now distinguishes "worker never wrote its pid sentinel" (exit 3) from "still running" (exit 1): the launch-drop retry treats a persistent exit 3 as not-launched and relaunches, and the poll loop errors after ~30s of consecutive exit 3s instead of spinning until the caller's timeout — or forever when none was set — for a worker the provider reaped before its first write or a launch that never ran.
