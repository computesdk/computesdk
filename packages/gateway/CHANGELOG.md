# @computesdk/gateway

## 0.3.4

### Patch Changes

- @computesdk/provider@1.0.19

## 0.3.3

### Patch Changes

- @computesdk/provider@1.0.18

## 0.3.2

### Patch Changes

- @computesdk/provider@1.0.17

## 0.3.1

### Patch Changes

- @computesdk/provider@1.0.16

## 0.3.0

### Minor Changes

- 64d560f: add namespace provider to gateway

## 0.2.1

### Patch Changes

- @computesdk/provider@1.0.15

## 0.2.0

### Minor Changes

- c2fa3f7: refactor api request for Render provider in gateway

## 0.1.0

### Minor Changes

- 128edac: refactor render package for gateway

### Patch Changes

- @computesdk/provider@1.0.14

## 0.0.7

### Patch Changes

- @computesdk/provider@1.0.13

## 0.0.6

### Patch Changes

- @computesdk/provider@1.0.12

## 0.0.5

### Patch Changes

- @computesdk/provider@1.0.11

## 0.0.4

### Patch Changes

- @computesdk/provider@1.0.10

## 0.0.3

### Patch Changes

- @computesdk/provider@1.0.9

## 0.0.2

### Patch Changes

- 4decff7: feat: Add @computesdk/gateway package and remove mode system

  - New `@computesdk/gateway` package with Railway infrastructure provider for gateway server use
  - New `defineInfraProvider()` factory for infrastructure-only providers
  - New `defineCompute()` factory for user-facing gateway routing
  - Simplified `@computesdk/railway` from ~270 lines to ~55 lines (routes through gateway)
  - Removed mode system (`ProviderMode`, `BaseProviderConfig`, `defaultMode`)
  - Configurable Docker image with `computesdk/compute:latest` default
  - Export `ExplicitComputeConfig` type from computesdk

- Updated dependencies [4decff7]
  - @computesdk/provider@1.0.8
