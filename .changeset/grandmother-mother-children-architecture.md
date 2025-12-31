---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/e2b": patch
"@computesdk/modal": patch
"@computesdk/railway": patch
"@computesdk/daytona": patch
"@computesdk/runloop": patch
"@computesdk/cloudflare": patch
"@computesdk/codesandbox": patch
"@computesdk/namespace": patch
"@computesdk/render": patch
"@computesdk/vercel": patch
"@computesdk/blaxel": patch
"@computesdk/fly": patch
"@computesdk/workbench": patch
---

# Grandmother/Mother/Children Architecture Refactor

Major architectural refactoring that splits computesdk into a clean three-tier structure.

## New Architecture

- **computesdk** (Grandmother) - User-facing SDK with gateway HTTP + Sandbox client
- **@computesdk/provider** (Mother) - Provider framework for building custom providers  
- **Provider packages** (Children) - Import from @computesdk/provider

## Changes to computesdk

- Removed `setConfig()`, `getConfig()`, `clearConfig()` methods from compute singleton
- Removed `createCompute()` (moved to @computesdk/provider)
- Gateway now uses direct HTTP implementation (not a provider)
- Merged @computesdk/client into computesdk package
- Renamed `sandbox.kill()` → `sandbox.destroy()`

## New @computesdk/provider Package

Contains the provider framework extracted from computesdk:
- `defineProvider()` function for defining custom providers
- `createCompute()` for direct mode
- Provider types and interfaces (Provider, ProviderSandbox, etc.)
- Universal Sandbox interface types

## Provider Package Updates

All 12 provider packages now:
- Import `defineProvider` from @computesdk/provider
- Import types from @computesdk/provider (which re-exports from computesdk)
- Have @computesdk/provider as a dependency

## Migration Guide

### Gateway Mode (unchanged)
```typescript
import { compute } from 'computesdk';
const sandbox = await compute.sandbox.create(); // Auto-detects from env
```

### Direct Mode (new location)
```typescript
import { createCompute } from '@computesdk/provider';
import { e2b } from '@computesdk/e2b';

const compute = createCompute({ defaultProvider: e2b({ apiKey: 'xxx' }) });
const sandbox = await compute.sandbox.create();
```

### Method Rename
```typescript
// Before
await sandbox.kill();

// After  
await sandbox.destroy();
```
