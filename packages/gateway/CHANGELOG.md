# @computesdk/gateway

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
