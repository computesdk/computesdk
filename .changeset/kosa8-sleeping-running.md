---
"@computesdk/kosa8": patch
---

`getInfo()` reports a sleeping sandbox as `running`: any command or file call wakes it in about a second. Stopped, deleted and expired sandboxes still report `stopped`.
