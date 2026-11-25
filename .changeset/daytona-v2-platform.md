---
"@computesdk/daytona": patch
---

Move the Daytona provider to `@daytona/sdk` 2.x and the Daytona v2 platform API. Templates map to v2 images, snapshots to v2 memory+disk snapshots, and a registry `image` boots through a v2 registry build. Pause/resume is dropped: Daytona v2 Linux sandboxes are ephemeral.
