---
"@computesdk/tensorlake": patch
---

Retry sandbox create briefly on "reached its quota": terminate() resolves before the project quota slot is released, so a destroy→create cycle could fail even with nothing still running.
