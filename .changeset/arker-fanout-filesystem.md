---
'@computesdk/arker': patch
---

Use native file transfer instead of payload-bearing shell commands to avoid persistent-shell memory growth on large writes. Resolve relative read and write paths against the guest working directory so both use native sync first, preserving UTF-8 BOMs. Fall back to the documented chunk sync API when streaming writes are unavailable, and reject malformed or incomplete chunked reads.
