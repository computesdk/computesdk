# @computesdk/gcp

## 0.1.9

### Patch Changes

- fc62a65: fix(gcp/cloud-run): chunk writeFile payloads into a staging file so a single `/bin/sh -c` argument stays under the kernel's MAX_ARG_STRLEN (spawn E2BIG on files >~96KB)

## 0.1.8

### Patch Changes

- 9a96346: cloud-run: spawn the sandbox CLI with a minimal env to avoid E2BIG

## 0.1.7

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 0.1.6

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 0.1.5

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.1.4

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.1.3

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.2

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.1.1

### Patch Changes

- 06db519: New `@computesdk/gcp` package: Google Cloud providers as subpath exports. Cloud Run Sandboxes move here as `import { cloudRun } from '@computesdk/gcp/cloud-run'` (provider `name` stays `cloud-run`). The gateway setup bin is `npx -p @computesdk/gcp computesdk-cloud-run`.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12
