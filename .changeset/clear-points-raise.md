---
"computesdk": minor
---

Add createCompute() function with proper getInstance() typing

- Add new createCompute() function that preserves provider type information
- Fix getInstance() returning 'any' type when using default provider configuration  
- Add TypedComputeAPI interface for type-safe compute operations
- Maintain full backward compatibility with existing compute singleton

Usage:
```typescript
import { createCompute } from 'computesdk'
import { e2b } from '@computesdk/e2b'

const compute = createCompute({
  defaultProvider: e2b({ apiKey: 'your-key' }),
});

const sandbox = await compute.sandbox.create();
const instance = sandbox.getInstance(); // ✅ Properly typed!
```
