---
"computesdk": minor
---

Add named sandbox support with findOrCreate and find methods

Implements namespace-based sandbox management where sandboxes can be referenced by stable (namespace, name) identifiers instead of just provider-generated UUIDs.

**New Methods:**
- `compute.sandbox.findOrCreate({ name, namespace?, timeout? })` - Find existing or create new sandbox by (namespace, name)
- `compute.sandbox.find({ name, namespace? })` - Find existing sandbox without creating

**Use Case:**
Instead of creating a new sandbox every time, you can now maintain "one sandbox per project" or "one sandbox per user" by using stable identifiers:

```typescript
// First call - creates new sandbox
const sandbox1 = await compute.sandbox.findOrCreate({
  name: 'my-app',
  namespace: 'user-123'
});

// Later call - returns same sandbox
const sandbox2 = await compute.sandbox.findOrCreate({
  name: 'my-app',
  namespace: 'user-123'
});
// sandbox1.sandboxId === sandbox2.sandboxId
```

**Features:**
- Namespace-based isolation (different namespaces = different sandboxes)
- Default namespace of "default" when not specified
- Automatic stale mapping cleanup
- Works with gateway provider (requires computesdk/edge PR #73)
- Backward compatible (new optional methods on provider interface)

**Breaking Changes:** None - this is a purely additive feature
