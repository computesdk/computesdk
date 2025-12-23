---
"computesdk": minor
"@computesdk/workbench": minor
---

Add named sandbox support, extend timeout functionality, and child sandbox REPL access

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

## Child Sandboxes in Workbench

The workbench REPL now exposes child sandbox operations:

**New REPL Methods:**
- `child.create()` - Create a child sandbox
- `child.list()` - List all child sandboxes
- `child.retrieve(subdomain)` - Get info about a specific child
- `child.destroy(subdomain, options?)` - Delete a child sandbox

**Example (in workbench REPL):**
```javascript
// Create a child sandbox (no await needed - promises are auto-awaited)
const child = child.create();
console.log(child.url); // https://sandbox-12345.sandbox.computesdk.com

// List all children
const children = child.list();

// Delete a child
child.destroy('sandbox-12345', { deleteFiles: true });
```

**Features:**
- Works similar to `filesystem` namespace in REPL
- Promises are auto-awaited (no need for `await` keyword)
- Auto-completion support
- Documented in help command
