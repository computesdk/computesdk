---
"@computesdk/microsandbox": patch
---

Stream large `writeFile`/`readFile` payloads so files of 1 MiB and up work on microsandbox cloud, where a single large fs call drops the channel.
