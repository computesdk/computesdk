---
'computesdk': patch
---

Fix getInstance() typing when using createCompute() with direct providers

Fixed a type inference issue where `sandbox.getInstance()` returned `unknown` instead of the provider's native sandbox type when using `createCompute()` with a direct provider (e.g., E2B, Modal).

The issue was caused by a forward declaration of the `Provider` interface in `sandbox.ts` that shadowed the real `Provider` interface from `provider.ts`, preventing proper type extraction.

**Before:**
```typescript
const provider = e2b({ apiKey: 'key' });
const compute = createCompute({ defaultProvider: provider });
const sandbox = await compute.sandbox.create();
const instance = sandbox.getInstance(); // Type: unknown ❌
```

**After:**
```typescript
const provider = e2b({ apiKey: 'key' });
const compute = createCompute({ defaultProvider: provider });
const sandbox = await compute.sandbox.create();
const instance = sandbox.getInstance(); // Type: E2BSandbox ✅
const id = instance.sandboxId; // Works! ✅
```
