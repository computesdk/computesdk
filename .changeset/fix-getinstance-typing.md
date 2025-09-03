---
"computesdk": minor
"@computesdk/test-utils": patch
---

Fix getInstance() typing to return provider-specific sandbox types

The `getInstance()` method now returns properly typed provider instances instead of the generic `Sandbox` type. This enables full TypeScript intellisense and type safety when working with provider-specific methods and properties.

**Before:**
```typescript
const instance = sandbox.getInstance(); // Returns generic Sandbox
// No intellisense for E2B-specific methods
```

**After:**
```typescript
const compute = createCompute({
  defaultProvider: e2b({ apiKey: 'your-key' }),
});

const sandbox = await compute.sandbox.create();
const instance = sandbox.getInstance(); // Returns properly typed E2B Sandbox
// Full intellisense: instance.sandboxId, instance.commands, instance.files, etc.
```

This change uses a phantom type approach (`__sandboxType`) to preserve type information through the provider chain, enabling TypeScript to correctly infer the native sandbox type.