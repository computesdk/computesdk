---
"@computesdk/uno": patch
---

Retry `destroy` when the delete is lost on the way: a dropped connection, a timeout, 429 or a 5xx from the edge is tried again up to four times over about 3 s (each attempt capped at 15 s). Before, one lost DELETE left the machine running and failed the caller's cleanup. DELETE is idempotent, and a repeat of a delete that did land answers 404, which counts as done.
