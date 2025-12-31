---
"computesdk": minor
"@computesdk/example-basic": patch
---

Add setConfig() method, remove runtime parameter, and update examples to use gateway mode

**Breaking Changes:**
- Removed `runtime` parameter from gateway's `CreateSandboxOptions` - runtime is determined by the provider, not specified at creation time
- Removed `handleComputeRequest` and related web framework integration exports (no longer needed)
- Use `sandbox.runCode(code, runtime)` to specify which runtime to use for execution

**New Features:**
- Added `compute.setConfig()` method for explicit gateway configuration
- Updated error messages to reference `setConfig()` instead of callable pattern

**Architecture:**
Two modes are now clearly separated:
1. **Gateway Mode** (recommended): `import { compute } from 'computesdk'` with auto-detection or `compute.setConfig()`
2. **Direct Mode** (advanced): `const compute = e2b({ apiKey: 'xxx' })` - providers are compute instances

**Runtime Selection:**
Runtime is no longer specified at sandbox creation. Instead, specify it when executing code:
- `sandbox.runCode(pythonCode, 'python')` - Execute Python code
- `sandbox.runCode(nodeCode, 'node')` - Execute Node.js code

**Updated Examples:**
All provider examples now demonstrate **gateway mode** using the `computesdk` package:
- e2b-example.ts - Gateway mode with E2B provider
- modal-example.ts - Gateway mode with Modal provider
- daytona-example.ts - Gateway mode with Daytona provider
- docker-example.ts - Direct mode (local Docker, no gateway needed)
- runloop-example.ts - Gateway mode with Runloop provider
- codesandbox-example.ts - Gateway mode with CodeSandbox provider
- blaxel-example.ts - Gateway mode with Blaxel provider
- vercel-example.ts - Gateway mode with Vercel provider

**Example Usage:**
```typescript
// Gateway mode with setConfig (recommended)
import { compute } from 'computesdk';
compute.setConfig({
  provider: 'e2b',
  apiKey: 'computesdk_xxx',
  e2b: { apiKey: 'e2b_xxx' }
});
const sandbox = await compute.sandbox.create();

// Gateway mode with auto-detection (zero-config)
// Just set COMPUTESDK_API_KEY and E2B_API_KEY environment variables
import { compute } from 'computesdk';
const sandbox = await compute.sandbox.create();

// Direct mode (advanced - for local providers like Docker)
import { docker } from '@computesdk/docker';
const compute = docker({ image: { name: 'python:3.11' } });
const sandbox = await compute.sandbox.create();
```
