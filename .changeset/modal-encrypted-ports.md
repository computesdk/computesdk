---
"@computesdk/modal": patch
---

Use `encryptedPorts` instead of `unencryptedPorts` when creating Modal sandboxes. This ensures the SDK <> sandbox connection is TLS-wrapped (https://) rather than plaintext (http://), improving both security and latency per Modal's recommendation.
