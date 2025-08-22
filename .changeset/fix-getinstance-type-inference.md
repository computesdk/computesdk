---
"computesdk": patch
---

Fix getInstance() type inference to eliminate need for manual type casting

Previously, `getInstance()` required explicit type parameters even when providers implemented typed methods:

```typescript
// Before (required manual casting)
await sandbox.getInstance<E2BSandbox>().setTimeout(minDurationMs);
```

Now type inference works automatically:

```typescript  
// After (automatic type inference)
await sandbox.getInstance().setTimeout(minDurationMs);
```

**Technical Details:**
- Fixed factory's `getInstance()` method to use proper generic constraints
- Updated Sandbox interface with function overloads for better type inference  
- Preserved backward compatibility with explicit type parameters
- Added comprehensive test coverage for type inference scenarios

**Root Cause:** 
The factory was casting provider-specific types through `unknown`, breaking TypeScript's type inference chain.

**Solution:**
- Constrained generic `T` to extend `TSandbox` for safe casting
- Added overloaded signatures to support both implicit and explicit typing
- Removed unnecessary `unknown` type casting that broke inference