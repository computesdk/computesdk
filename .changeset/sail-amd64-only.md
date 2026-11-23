---
"@computesdk/sail": patch
---

Create Sail sandboxes on AMD64 only. Default to the AMD64 Devbox, constrain per-create registry images to AMD64, and reject configured ARM64 images and ARM64 snapshot restores. Existing ARM64 sandboxes remain accessible for management and termination.
