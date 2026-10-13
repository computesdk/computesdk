---
'@computesdk/gcp': patch
---

New `@computesdk/gcp` package: Google Cloud providers as subpath exports. Cloud Run Sandboxes move here as `import { cloudRun } from '@computesdk/gcp/cloud-run'` (provider `name` stays `cloud-run`). The gateway setup bin is `npx -p @computesdk/gcp computesdk-cloud-run`.
