---
'@computesdk/arker': patch
---

Use native file transfer instead of payload-bearing shell commands to avoid persistent-shell memory growth on large writes. Resolve relative paths against the guest working directory and fall back to the documented chunk sync API when streaming sync is unavailable.
