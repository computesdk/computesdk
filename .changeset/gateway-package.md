---
"@computesdk/gateway": patch
"@computesdk/provider": patch
"@computesdk/railway": patch
"computesdk": patch
"@computesdk/e2b": patch
"@computesdk/daytona": patch
---

feat: Add @computesdk/gateway package and remove mode system

- New `@computesdk/gateway` package with Railway infrastructure provider for gateway server use
- New `defineInfraProvider()` factory for infrastructure-only providers
- New `defineCompute()` factory for user-facing gateway routing
- Simplified `@computesdk/railway` from ~270 lines to ~55 lines (routes through gateway)
- Removed mode system (`ProviderMode`, `BaseProviderConfig`, `defaultMode`)
- Configurable Docker image with `computesdk/compute:latest` default
- Export `ExplicitComputeConfig` type from computesdk
