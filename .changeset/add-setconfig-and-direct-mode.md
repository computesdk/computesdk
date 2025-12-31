---
"computesdk": minor
"@computesdk/example-basic": patch
---

Add setConfig() method and update examples to use direct mode

**Breaking Changes:**
- Examples no longer use `createCompute()` wrapper - providers are used directly
- `CodeResult` interface uses `output` instead of `stdout`, removed `executionTime`
- Sandbox cleanup uses `destroy()` instead of `kill()`

**New Features:**
- Added `compute.setConfig()` method for explicit gateway configuration
- Updated error messages to reference `setConfig()` instead of callable pattern

**Architecture:**
Two modes are now clearly separated:
1. **Gateway Mode** (recommended): `import { compute } from 'computesdk'` with auto-detection or `compute.setConfig()`
2. **Direct Mode** (advanced): `const compute = e2b({ apiKey: 'xxx' })` - providers are compute instances

**Updated Examples:**
All provider examples now demonstrate direct mode usage:
- e2b-example.ts
- modal-example.ts
- daytona-example.ts
- docker-example.ts
- runloop-example.ts
- codesandbox-example.ts
- blaxel-example.ts
- vercel-example.ts

**Example Usage:**
```typescript
// Gateway mode with setConfig
import { compute } from 'computesdk';
compute.setConfig({
  provider: 'e2b',
  apiKey: 'computesdk_xxx',
  e2b: { apiKey: 'e2b_xxx' }
});
const sandbox = await compute.sandbox.create();

// Direct mode (new pattern)
import { e2b } from '@computesdk/e2b';
const compute = e2b({ apiKey: 'e2b_xxx' });
const sandbox = await compute.sandbox.create();
```
