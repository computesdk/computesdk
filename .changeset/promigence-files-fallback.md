---
'@computesdk/promigence': patch
---

Files are read, written, checked and listed with shell commands when the Promigence API refuses the installed SDK's files API (path in the URL), so filesystem calls keep working.
