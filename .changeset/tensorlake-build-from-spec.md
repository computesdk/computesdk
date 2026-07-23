---
"@computesdk/tensorlake": patch
---

Fix `template.create` to support build-from-spec. Tensorlake can build a template from a Dockerfile or base image (plus env vars / build commands) via the SDK's native `Image` builder, which registers a named sandbox image. Previously `template.create` threw for anything other than capture-from-sandbox.
