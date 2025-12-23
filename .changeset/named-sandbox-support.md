---
"computesdk": minor
---

Add named sandbox support and extend timeout functionality

## Named Sandboxes

Sandboxes can now be referenced by stable (namespace, name) identifiers instead of just provider-generated UUIDs.

**New Methods:**
- `compute.sandbox.findOrCreate({ name, namespace?, timeout? })` - Find existing or create new sandbox by (namespace, name)
- `compute.sandbox.find({ name, namespace? })` - Find existing sandbox without creating

**Example:**
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
- Works with gateway provider

## Extend Timeout

You can now extend the timeout/expiration of an existing sandbox to keep it alive longer:

**New Method:**
- `compute.sandbox.extendTimeout(sandboxId, options?)` - Extend sandbox timeout

**Example:**
```typescript
// Extend timeout by default 15 minutes
await compute.sandbox.extendTimeout('sandbox-123');

// Extend timeout by custom duration (30 minutes)
await compute.sandbox.extendTimeout('sandbox-123', {
  duration: 30 * 60 * 1000
});

// Useful with named sandboxes
const sandbox = await compute.sandbox.findOrCreate({
  name: 'long-running-task',
  namespace: 'user-alice'
});

// Extend timeout before it expires
await compute.sandbox.extendTimeout(sandbox.sandboxId, {
  duration: 60 * 60 * 1000 // 1 hour
});
```

**Features:**
- Default extension duration is 15 minutes (900000ms)
- Only available with gateway provider
- Gateway endpoint: `POST /v1/sandbox/:id/extend`
