---
"@computesdk/run-cloud": patch
---

Chunk `filesystem.writeFile` payloads into 48,000-character base64 commands to avoid "Command initialization frame is too large" errors when writing files larger than the Run Cloud command frame limit.

Also normalizes dash-leading paths so they are not parsed as command options by `mkdir`, `cat`, `find`, `test`, or `rm`.
