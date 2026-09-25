---
"@computesdk/tenki": patch
---

Map filesystem paths outside the guest workdir into /home/tenki so sandbox filesystem operations work when callers provide absolute paths like /tmp/bench.
