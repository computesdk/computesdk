---
"@computesdk/blaxel": patch
---

Templates now work on Blaxel. `template.create({ name, image })` builds the image into the workspace registry with Blaxel's sandbox API added, without deploying a sandbox, and returns the image ref as the template id. `sandbox.create({ templateId })` boots that image, `template.list()` returns one template per sandbox image tag, and `template.delete(id)` removes the tag.
