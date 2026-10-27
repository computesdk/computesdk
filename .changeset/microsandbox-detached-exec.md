---
"@computesdk/microsandbox": patch
---

Run `runCommand` commands as detached workers (setsid + on-guest sentinel files) and poll status with short-lived execs. The cloud relay drops exec sessions around ~2 minutes, which killed any long-running command mid-flight; detached mode keeps every exec under the lifetime cap while preserving exit code, stdout/stderr, timeout (exit 124 + process-group kill), and a fast failure when the runtime reaps the worker.
