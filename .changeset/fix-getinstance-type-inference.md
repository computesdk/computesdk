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
- Simplified Sandbox interface to single generic `getInstance<T = any>(): T` signature
- Preserved backward compatibility with explicit type parameters
- Added comprehensive test coverage for type inference scenarios

**Root Cause:** 
The Sandbox interface had conflicting overloads `getInstance(): any; getInstance<T>(): T;` where TypeScript always chose the first overload returning `any`, breaking type inference.

**Solution:**
- Removed problematic `getInstance(): any;` overload from Sandbox interface
- Factory implementation now properly preserves provider-specific types through generic constraints
- Provider-specific `getInstance` methods can now return their proper types without casting through `any`