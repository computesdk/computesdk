---
'@computesdk/workbench': patch
---

Load the Cloud Run provider from `@computesdk/gcp/cloud-run`, falling back to the deprecated `@computesdk/cloud-run` for existing installs. `@computesdk/gcp` is added as an optional peer dependency, and install hints for `cloud-run` now point at `@computesdk/gcp`.
