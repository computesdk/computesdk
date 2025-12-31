# ComputeSDK Major Refactoring

## Overview

This refactoring splits the monolithic `computesdk` package into a clean architectural pattern we call "Grandmother/Mother/Children":

- **computesdk** (Grandmother) - User-facing SDK with gateway HTTP implementation
- **@computesdk/provider** (Mother) - Provider framework for building custom providers  
- **@computesdk/* providers** (Children) - Individual provider packages

## Key Changes

### 1. New `@computesdk/provider` Package

Created a new package containing the provider framework:
- `createProvider()` - Factory for building custom providers
- `createCompute()` - API for direct mode (bypassing gateway)
- Provider types and interfaces
- Utility functions

### 2. Merged `@computesdk/client` into `computesdk`

The Sandbox client is now part of the main `computesdk` package:
- Moved from `@computesdk/client` to `computesdk/client`
- Deleted separate `@computesdk/client` package
- All client functionality now in one place

### 3. Gateway Refactored to Direct HTTP

Gateway is no longer implemented as a provider:
- Removed provider abstraction layer
- Direct HTTP calls to gateway API
- Cleaner, more efficient implementation
- Added `findOrCreate()` and `find()` as first-class methods

### 4. Updated All Provider Packages

All 12 provider packages now:
- Import `createProvider` from `@computesdk/provider`
- Import types from both `@computesdk/provider` and `computesdk`
- Have `@computesdk/provider` as a dependency

## Breaking Changes

### Removed APIs

- ❌ `compute.setConfig()` - No longer needed
- ❌ `compute.getConfig()` - No longer needed  
- ❌ `compute.clearConfig()` - No longer needed
- ❌ `createCompute()` from `computesdk` - Moved to `@computesdk/provider`
- ❌ `@computesdk/client` package - Merged into `computesdk`

### Migration Guide

**Before (Old Architecture):**
```typescript
import { compute, createCompute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

// Old way - using setConfig
compute.setConfig({ 
  defaultProvider: e2b({ apiKey: 'xxx' }) 
});
const sandbox1 = await compute.sandbox.create();

// Old way - using createCompute
const compute2 = createCompute({ 
  defaultProvider: e2b({ apiKey: 'xxx' }) 
});
const sandbox2 = await compute2.sandbox.create();
```

**After (New Architecture):**
```typescript
// Gateway mode (zero-config) - Auto-detects from env vars
import { compute } from 'computesdk';
const sandbox = await compute.sandbox.create();

// Gateway mode (explicit config) - Returns new instance
import { compute } from 'computesdk';
const sandbox = await compute({
  provider: 'e2b',
  apiKey: 'computesdk_xxx',
  e2b: { apiKey: 'e2b_xxx' }
}).sandbox.create();

// Direct mode - Bypass gateway, talk directly to provider
import { createCompute } from '@computesdk/provider';
import { e2b } from '@computesdk/e2b';

const provider = e2b({ apiKey: 'xxx' });
const compute = createCompute({ defaultProvider: provider });
const sandbox = await compute.sandbox.create();
```

## Architecture Benefits

### Clear Separation of Concerns

- **computesdk** - Gateway mode for end users
- **@computesdk/provider** - Framework for provider developers
- **Provider packages** - Clean, independent implementations

### No Circular Dependencies

- Core imports types from computesdk (type-level only)
- Providers import from core
- Clean dependency flow

### Better Type Safety

Direct mode with `createCompute()` preserves provider-specific types:
```typescript
const provider = e2b({ apiKey: 'xxx' });
const compute = createCompute({ defaultProvider: provider });
const sandbox = await compute.sandbox.create();

// TypeScript knows the exact provider-specific instance type
const e2bInstance = sandbox.getInstance(); // Properly typed!
```

### Smaller Bundle Sizes

Users only install what they need:
- Gateway mode: Just `computesdk`
- Direct mode: `@computesdk/provider` + specific providers

## Testing

All tests passing:
- ✅ `@computesdk/provider`: 18 tests
  - factory.test.ts
  - utils.test.ts
  - createCompute.test.ts
  
- ✅ `computesdk`: 60 tests
  - auto-detect.test.ts (24 tests)
  - client/protocol.test.ts (36 tests)

## Package Versions

This refactoring affects the following packages:

**Major Changes:**
- `computesdk@2.0.0` - Breaking API changes
- `@computesdk/provider@1.0.0` - New package

**Minor Changes (updated imports):**
- All provider packages (e2b, modal, railway, etc.)

## Implementation Details

### Files Moved to @computesdk/provider

- `factory.ts` - Provider factory function
- `utils.ts` - Utility functions (calculateBackoff)
- `types/provider.ts` - Provider type definitions
- `types/sandbox.ts` - Sandbox type definitions
- `compute.ts` - createCompute function for direct mode

### Files Merged into computesdk

All of `@computesdk/client` moved to `packages/computesdk/src/client/`:
- Sandbox class
- Protocol implementation
- Terminal, WebSocket, FileWatcher, SignalService
- All client resources

### Files Refactored in computesdk

- `compute.ts` - Rewritten to use direct HTTP calls
- `auto-detect.ts` - Returns GatewayConfig instead of Provider
- `explicit-config.ts` - Renamed function, returns GatewayConfig
- Provider-specific gateway implementation removed

## Next Steps

1. ✅ Create changesets
2. ⏳ Update documentation
3. ⏳ Redo examples with new patterns
4. ⏳ Publish packages

## Questions?

See the full PR description for more details or reach out to the team.
