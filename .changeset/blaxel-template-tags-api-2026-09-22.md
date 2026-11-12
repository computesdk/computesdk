---
'@computesdk/blaxel': patch
---

Read template tags under Blaxel API version 2026-09-22. `@blaxel/core` 0.3.23 and later send that version, where `getImage` and `listImages` return image summaries with a tag count and no tags. `template.create` never saw the new tag and threw "built but has no tag yet" after 15 minutes, and `template.list` returned nothing. Tags now come from `listImageTags`, a page at a time, and `template.list` reads every page of `listImages`. Images that still carry `spec.tags` (older API versions) work as before. Depends on `@blaxel/core` ^0.3.38.
