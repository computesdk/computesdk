---
'@computesdk/provider': patch
---

Providers without native filesystem methods now get a working `sandbox.filesystem` built on `runCommand` (base64 over POSIX `sh`) instead of one that throws "not supported".
