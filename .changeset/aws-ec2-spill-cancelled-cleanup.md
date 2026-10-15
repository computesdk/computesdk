---
"@computesdk/aws": patch
---

EC2: remove spilled output files when SSM reports a command `Cancelled`, or when partial output after a timeout can't be read back.
