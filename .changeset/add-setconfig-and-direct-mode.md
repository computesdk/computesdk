---
"computesdk": patch
---

Add setConfig() method, remove runtime parameter, UI package, and web framework examples

**Breaking Changes:**
- Removed `runtime` parameter from gateway's `CreateSandboxOptions` - runtime is determined by the provider, not specified at creation time
- Removed `handleComputeRequest` and related web framework integration exports (no longer needed)
- Removed `@computesdk/ui` package (built for pre-gateway architecture, will be redesigned for gateway)
- Removed web framework examples (Next.js, Nuxt, SvelteKit, Remix, Astro) - will be rebuilt for gateway architecture
- Use `sandbox.runCode(code, runtime)` to specify which runtime to use for execution

**New Features:**
- Added `compute.setConfig()` method for explicit configuration
- Updated error messages to reference `setConfig()` instead of callable pattern

**Two Ways to Use ComputeSDK:**

1. **Using ComputeSDK** (recommended):
   - `import { compute } from 'computesdk'`
   - Zero-config with environment variables or explicit `compute.setConfig()`
   - Works with all providers through unified interface

2. **Using providers directly** (advanced):
   - `import { e2b } from '@computesdk/e2b'`
   - Use provider SDKs directly without ComputeSDK wrapper
   - Useful for local providers (Docker) or provider-specific features

**Runtime Selection:**
Runtime is no longer specified at sandbox creation. Instead, specify it when executing code:
- `sandbox.runCode(pythonCode, 'python')` - Execute Python code
- `sandbox.runCode(nodeCode, 'node')` - Execute Node.js code

**Updated Examples:**
All provider examples now demonstrate **using ComputeSDK**:
- e2b-example.ts - Using ComputeSDK with E2B provider
- modal-example.ts - Using ComputeSDK with Modal provider
- daytona-example.ts - Using ComputeSDK with Daytona provider
- docker-example.ts - Using Docker provider directly (local, no gateway)
- runloop-example.ts - Using ComputeSDK with Runloop provider
- codesandbox-example.ts - Using ComputeSDK with CodeSandbox provider
- blaxel-example.ts - Using ComputeSDK with Blaxel provider
- vercel-example.ts - Using ComputeSDK with Vercel provider

**Example Usage:**
```typescript
// Using ComputeSDK with setConfig (recommended)
import { compute } from 'computesdk';
compute.setConfig({
  provider: 'e2b',
  apiKey: 'computesdk_xxx',
  e2b: { apiKey: 'e2b_xxx' }
});
const sandbox = await compute.sandbox.create();

// Using ComputeSDK with zero-config (auto-detection)
// Just set COMPUTESDK_API_KEY and E2B_API_KEY environment variables
import { compute } from 'computesdk';
const sandbox = await compute.sandbox.create();

// Using Docker provider directly (for local providers)
import { docker } from '@computesdk/docker';
const compute = docker({ image: { name: 'python:3.11' } });
const sandbox = await compute.sandbox.create();
```
