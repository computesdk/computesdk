---
'@computesdk/archil': patch
---

Persistent sandboxes expose `pause()`/`resume()` on the instance handle (`sandbox.getInstance()`), and exec-mode commands export env vars instead of prefixing them, so compound commands like `(a; b)` or `{ a; }` no longer fail with a shell syntax error.
