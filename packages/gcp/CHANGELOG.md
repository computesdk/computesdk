# @computesdk/gcp

## 0.1.1

### Patch Changes

- 06db519: New `@computesdk/gcp` package: Google Cloud providers as subpath exports. Cloud Run Sandboxes move here as `import { cloudRun } from '@computesdk/gcp/cloud-run'` (provider `name` stays `cloud-run`). The gateway setup bin is `npx -p @computesdk/gcp computesdk-cloud-run`.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12
