---
"@computesdk/superserve": patch
---

Implement `template.create` via Superserve's template builder (`from`, `vcpu`, `memoryMib`, `diskMib`, `steps`, `startCmd`, `readyCmd`), waiting until the build is ready; template metadata now includes `diskMib` and build `errorMessage`.
