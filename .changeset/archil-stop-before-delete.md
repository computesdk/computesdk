---
"@computesdk/archil": patch
---

Stop running Archil sandboxes before deleting them on `destroy` and `snapshot.delete`; Archil rejects deleting a live sandbox.
