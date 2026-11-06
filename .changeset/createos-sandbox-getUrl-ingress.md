---
"@computesdk/createos-sandbox": patch
---

`getUrl` enables ingress on demand: sandboxes are created with ingress off, so requesting a URL now turns it on instead of throwing "No ingress URL is available".
