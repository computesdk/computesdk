---
"@computesdk/namespace": patch
---

Report a failing command's real exit code. Namespace returns exit code 1 for every failure and puts the real code in a trailing `exec failed with exit code N` stderr line, which is now stripped.
