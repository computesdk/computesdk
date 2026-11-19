---
"@computesdk/modal": patch
---

Correct the Modal provider docs: exposed ports use encrypted (`encryptedPorts`, TLS/`https://`) tunnels, not unencrypted ones, matching the adapter's behavior since the switch to `encryptedPorts`. Also update the README's stated Modal JS SDK line from v0.7 to v0.11 to match the declared `modal@0.11.0` dependency.
