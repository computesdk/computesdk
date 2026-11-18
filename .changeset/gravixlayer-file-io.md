---
"@computesdk/gravixlayer": patch
---

`readFile` now streams through the binary download endpoint, and `writeFile` above 1 MiB routes through the binary upload endpoint — writes and reads larger than the JSON body cap succeed instead of failing.
