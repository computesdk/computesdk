---
'@computesdk/steel': patch
---

Retry Steel's 404s for just-created sessions in `getById`, `getConnectUrl` and `destroy`, and only map 400/404/422 to `null` in `getById` instead of swallowing every error.
