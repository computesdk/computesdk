---
"computesdk": minor
---

Add filesystem overlay API for instant sandbox setup from template directories

- Add `sandbox.filesystem.overlay.create({ source, target })` to create overlays
- Add `sandbox.filesystem.overlay.list()` to list all overlays
- Add `sandbox.filesystem.overlay.retrieve(id)` to get overlay status (useful for polling)
- Add `sandbox.filesystem.overlay.destroy(id)` to delete overlays
- Overlays symlink template files for instant access, then copy heavy directories in background
