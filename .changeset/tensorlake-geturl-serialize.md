---
"@computesdk/tensorlake": patch
---

`getUrl` serializes exposed-ports updates per sandbox and skips the update when the port is already exposed publicly; it now fails instead of clobbering other exposed ports when the current port list can't be read.
