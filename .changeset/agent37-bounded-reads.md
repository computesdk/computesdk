---
"@computesdk/agent37": patch
---

Read large UTF-8 files using bounded exec transfers rather than exceeding Agent37's output limit. Preserve multibyte text across chunk boundaries and reject truncated, malformed, failed, short or detectably changed reads.
