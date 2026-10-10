---
"@computesdk/archil": patch
---

Persistent-mode `destroy` and snapshot `delete` stop a running or paused sandbox before deleting it. Archil rejects deleting a sandbox that has not stopped, exited or failed, so `destroy` failed with a 409 and left the VM running until its TTL.
