# Named Sandbox Feature - Implementation Summary

## ✅ Status: Complete and Ready for Review

This document summarizes the implementation of the named sandbox feature for ComputeSDK.

## Overview

Implemented `findOrCreate` and `find` methods that allow developers to reference sandboxes by stable (namespace, name) identifiers instead of provider-generated UUIDs.

**Use Case:** "One sandbox per project" pattern - maintain persistent sandboxes across application restarts without manually tracking UUIDs.

## Implementation Details

### API Design

Based on gateway PR #73 (https://github.com/computesdk/edge/pull/73), we aligned with the REST API:

```typescript
// Gateway API endpoints
POST /v1/sandbox/find-or-create
POST /v1/sandbox/find

// SDK API methods
compute.sandbox.findOrCreate({ name, namespace?, timeout? })
compute.sandbox.find({ name, namespace? })
```

### Key Decisions

1. **Property Names:** `id`, `name`, `namespace`
   - `id` = Provider-generated UUID (sandboxId)
   - `name` = User-provided stable identifier  
   - `namespace` = Isolation scope

2. **Default Namespace:** `"default"`
   - When `namespace` is omitted, defaults to `"default"`
   - Allows global sandboxes without requiring namespace parameter

3. **Optional Methods:** 
   - Added to `ProviderSandboxManager` as optional methods
   - Only gateway provider implements them
   - Other providers throw helpful error messages

4. **Backward Compatibility:**
   - All changes are additive
   - No breaking changes to existing API
   - Existing code continues to work

## Files Changed

### Core Implementation (4 files)

1. **packages/computesdk/src/types/provider.ts** (+32 lines)
   - Added `FindOrCreateSandboxOptions` interface
   - Added `FindSandboxOptions` interface
   - Extended `ProviderSandboxManager` with optional methods
   - Updated `ComputeAPI` and `TypedComputeAPI` interfaces

2. **packages/computesdk/src/compute.ts** (+68 lines)
   - Implemented `compute.sandbox.findOrCreate()`
   - Implemented `compute.sandbox.find()`
   - Added methods to `TypedComputeAPI`

3. **packages/computesdk/src/factory.ts** (+51 lines)
   - Updated `SandboxMethods` interface
   - Added `findOrCreate` to `GeneratedSandboxManager`
   - Added `find` to `GeneratedSandboxManager`

4. **packages/computesdk/src/providers/gateway.ts** (+112 lines)
   - Implemented `findOrCreate` method
   - Implemented `find` method
   - Calls gateway REST API endpoints
   - Handles metadata storage

### Tests & Documentation (5 files)

5. **packages/computesdk/src/__tests__/named-sandbox.test.ts** (133 lines)
   - 8 comprehensive tests
   - Type safety verification
   - Provider support detection
   - Parameter validation

6. **docs/features/named-sandboxes.md** (328 lines)
   - Complete feature guide
   - API reference
   - Use cases and examples
   - Migration guide

7. **examples/named-sandbox-example.ts** (100 lines)
   - 7 example scenarios
   - Common usage patterns
   - Best practices

8. **.changeset/named-sandbox-support.md** (38 lines)
   - Changeset for version bump
   - Feature changelog

9. **COMPUTE_SANDBOX_UPDATED.md** (408 lines)
   - Implementation guide for consumer applications
   - Detailed usage examples

## Testing

### Test Results
```
✓ All 143 tests passing (8 new tests added)
✓ TypeScript compilation succeeds
✓ Package builds successfully
```

### Test Coverage
- Type safety verification
- Provider support detection  
- Gateway provider methods
- Parameter validation
- Error handling

## Usage Examples

### Basic Usage

```typescript
import { compute } from 'computesdk';

// Find or create
const sandbox = await compute.sandbox.findOrCreate({
  name: 'my-app',
  namespace: 'user-alice',
  timeout: 1800000
});

// Find without creating
const existing = await compute.sandbox.find({
  name: 'my-app',
  namespace: 'user-alice'
});

if (existing) {
  console.log('Found:', existing.sandboxId);
}
```

### Advanced Patterns

#### User-Scoped Sandboxes
```typescript
async function getUserSandbox(userId: string, projectId: string) {
  return await compute.sandbox.findOrCreate({
    name: projectId,
    namespace: `user-${userId}`,
    timeout: 2 * 60 * 60 * 1000
  });
}
```

#### Session Persistence
```typescript
// Reconnect to existing sandbox
const sandbox = await compute.sandbox.find({
  name: 'workspace',
  namespace: `user-${userId}`
});

if (!sandbox) {
  // Create if doesn't exist
  sandbox = await compute.sandbox.findOrCreate({
    name: 'workspace',
    namespace: `user-${userId}`
  });
}
```

## Integration Requirements

### Gateway Dependencies
- Requires ComputeSDK edge gateway with PR #73 merged
- Endpoints: `/v1/sandbox/find-or-create` and `/v1/sandbox/find`
- Redis/database for (namespace, name) → sandboxId mapping

### SDK Dependencies
- No new package dependencies
- Works with existing `@computesdk/client`
- Compatible with all existing providers (optional feature)

## Migration Path

### From UUID Tracking

**Before:**
```typescript
// Manual UUID tracking in database
const sandboxId = await db.getSandboxId(userId);
let sandbox;

if (sandboxId) {
  sandbox = await compute.sandbox.getById(sandboxId);
}

if (!sandbox) {
  sandbox = await compute.sandbox.create();
  await db.saveSandboxId(userId, sandbox.sandboxId);
}
```

**After:**
```typescript
// Automatic mapping via gateway
const sandbox = await compute.sandbox.findOrCreate({
  name: 'workspace',
  namespace: `user-${userId}`
});
```

## API Contract with Gateway

### Request: Find or Create
```typescript
POST /v1/sandbox/find-or-create
{
  "namespace": "user-alice",  // Optional, defaults to "default"
  "name": "my-app",           // Required
  "timeout": 1800000          // Optional
}
```

### Response: Find or Create
```json
{
  "success": true,
  "data": {
    "sandboxId": "sb_abc123",
    "name": "my-app",
    "namespace": "user-alice",
    "provider": "e2b",
    "url": "https://...",
    "token": "...",
    "metadata": { ... }
  }
}
```

### Request: Find
```typescript
POST /v1/sandbox/find
{
  "namespace": "user-alice",
  "name": "my-app"
}
```

### Response: Find (Success)
```json
{
  "success": true,
  "data": {
    "sandboxId": "sb_abc123",
    "name": "my-app",
    "namespace": "user-alice",
    "url": "...",
    "token": "..."
  }
}
```

### Response: Find (Not Found)
```json
{
  "success": true,
  "data": null
}
```

## Next Steps

### Before Merge
1. ✅ Implementation complete
2. ✅ Tests passing
3. ✅ Documentation complete
4. ⏳ Code review
5. ⏳ Gateway PR #73 review

### After Gateway Merge
1. Test integration with deployed gateway
2. Update SDK version
3. Release via changeset
4. Update documentation site
5. Announce feature

## Rollout Strategy

### Phase 1: Internal Testing
- Deploy gateway with PR #73
- Test SDK with internal projects
- Verify (namespace, name) mapping works
- Test stale mapping cleanup

### Phase 2: Beta Release
- Release SDK as beta version
- Document feature in changelog
- Gather feedback from early adopters

### Phase 3: Stable Release  
- Promote to stable version
- Update main documentation
- Create migration guide for users

## Risks & Mitigations

### Risk: Gateway PR #73 Changes API
**Mitigation:** Our implementation closely follows PR #73's REST API, minimal changes expected

### Risk: Stale Mappings Accumulate
**Mitigation:** Gateway implements automatic cleanup on lookup, TTL on Redis keys

### Risk: Provider Compatibility
**Mitigation:** Feature is optional, only gateway provider implements it, others throw clear errors

## Metrics to Track

Post-launch metrics to monitor:
- Adoption rate (% of sandboxes created via findOrCreate)
- Average sandbox reuse rate
- Stale mapping cleanup frequency  
- Error rates on find/findOrCreate

## Related Documents

- [Feature Documentation](docs/features/named-sandboxes.md)
- [Usage Examples](examples/named-sandbox-example.ts)
- [Consumer Guide](COMPUTE_SANDBOX_UPDATED.md)
- [Gateway PR #73](https://github.com/computesdk/edge/pull/73)
- [Changeset](.changeset/named-sandbox-support.md)

## Contact

For questions about this implementation:
- Review feature branch: `feature/named-sandbox-support`
- Check commit: `5da0695`
- Refer to test suite for detailed examples
