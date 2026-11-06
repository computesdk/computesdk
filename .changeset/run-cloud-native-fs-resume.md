---
"@computesdk/run-cloud": patch
---

Write files through Run Cloud's native chunked file API, stage commands too large for one exec frame as a script, and transparently resume idle-paused sandboxes before retrying exec and file operations.
