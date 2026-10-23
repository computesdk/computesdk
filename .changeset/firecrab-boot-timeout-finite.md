---
"@computesdk/ec2-firecrab": patch
---

Fall back to the 120s default when `bootTimeoutMs` is non-finite or non-positive — an unbounded deadline would strand the allocated microVM.
