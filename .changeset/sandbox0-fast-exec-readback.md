---
"@computesdk/sandbox0": patch
---

Read `runCommand` output capture files over the file API in one parallel round trip instead of six follow-up commands, falling back to byte-verified command reads on a short or failed read.
