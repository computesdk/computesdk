# Named Sandboxes

Named sandboxes allow you to reference sandboxes by stable, human-readable identifiers instead of provider-generated UUIDs.

## Overview

Instead of creating a new sandbox every time and tracking the UUID yourself, you can use `findOrCreate` to implement "one sandbox per project" or "one sandbox per user" patterns.

## Quick Start

```typescript
import { compute } from 'computesdk';

// First call - creates new sandbox
const sandbox = await compute.sandbox.findOrCreate({
  name: 'my-app',           // Your stable identifier
  namespace: 'user-alice',  // Isolation scope
  timeout: 30 * 60 * 1000   // 30 minutes
});

// Later call - returns same sandbox
const sameBox = await compute.sandbox.findOrCreate({
  name: 'my-app',
  namespace: 'user-alice'
});

console.log(sandbox.sandboxId === sameBox.sandboxId); // true
```

## API Reference

### `compute.sandbox.findOrCreate(options)`

Find existing sandbox or create new one by (namespace, name).

**Parameters:**
- `options.name` (string, required): Stable identifier for your sandbox
- `options.namespace` (string, optional): Isolation scope, defaults to `"default"`
- `options.timeout` (number, optional): Timeout in milliseconds
- `options.*` (any): Additional `CreateSandboxOptions` (runtime, templateId, etc.)

**Returns:** `Promise<ProviderSandbox>` - Same sandbox instance on repeated calls

**Example:**
```typescript
const sandbox = await compute.sandbox.findOrCreate({
  name: 'frontend-dev',
  namespace: 'project-123',
  timeout: 3600000, // 1 hour
  runtime: 'node'
});
```

### `compute.sandbox.find(options)`

Find existing sandbox without creating (returns null if not found).

**Parameters:**
- `options.name` (string, required): Sandbox name to find
- `options.namespace` (string, optional): Namespace to search in, defaults to `"default"`

**Returns:** `Promise<ProviderSandbox | null>` - Sandbox if found, null otherwise

**Example:**
```typescript
const sandbox = await compute.sandbox.find({
  name: 'frontend-dev',
  namespace: 'project-123'
});

if (sandbox) {
  console.log('Found:', sandbox.sandboxId);
} else {
  console.log('Not found');
}
```

### `compute.sandbox.extendTimeout(sandboxId, options)`

Extend the timeout/expiration of an existing sandbox.

**Parameters:**
- `sandboxId` (string, required): ID of the sandbox to extend
- `options.duration` (number, optional): Additional time to extend in milliseconds. Defaults to `900000` (15 minutes)

**Returns:** `Promise<void>`

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

**Note:** Only available with gateway provider. Other providers will throw an error.

## Concepts

### Name

A user-defined stable identifier for your sandbox. This can be:
- Project name: `"my-react-app"`
- Environment: `"staging"`, `"production"`
- User workspace: `"user-workspace-123"`
- Any other stable identifier meaningful to your application

**Requirements:**
- Must be provided
- Should be stable (not change over time)
- Unique within a namespace

### Namespace

An isolation scope that allows different entities to use the same name without conflicts.

**Common patterns:**
- User isolation: `namespace: "user-{userId}"`
- Organization isolation: `namespace: "org-{orgId}"`
- Multi-tenant: `namespace: "{tenantId}"`
- Global shared: `namespace: "default"` (or omit the parameter)

**Behavior:**
- Defaults to `"default"` if not provided
- Same `(namespace, name)` → always returns the same sandbox
- Different namespaces → different sandboxes (even with same name)

### Composite Key

The unique identifier is the combination of `(namespace, name)`:

```typescript
// These create/return DIFFERENT sandboxes:
await compute.sandbox.findOrCreate({ name: 'app', namespace: 'user-1' });
await compute.sandbox.findOrCreate({ name: 'app', namespace: 'user-2' });

// These return the SAME sandbox:
await compute.sandbox.findOrCreate({ name: 'app', namespace: 'user-1' });
await compute.sandbox.findOrCreate({ name: 'app', namespace: 'user-1' });
```

## Use Cases

### 1. User-Scoped Development Environments

Each user gets their own isolated sandbox per project:

```typescript
async function getUserSandbox(userId: string, projectId: string) {
  return await compute.sandbox.findOrCreate({
    name: projectId,
    namespace: `user-${userId}`,
    timeout: 2 * 60 * 60 * 1000 // 2 hours
  });
}

// User Alice working on project-123
const aliceBox = await getUserSandbox('alice', 'project-123');

// User Bob working on same project-123
const bobBox = await getUserSandbox('bob', 'project-123');

// Different sandboxes!
console.log(aliceBox.sandboxId !== bobBox.sandboxId); // true
```

### 2. Shared Team Sandboxes

Teams share sandboxes within an organization:

```typescript
async function getTeamSandbox(orgId: string, environment: string) {
  return await compute.sandbox.findOrCreate({
    name: environment,
    namespace: `org-${orgId}`,
    timeout: 24 * 60 * 60 * 1000 // 24 hours
  });
}

// All team members in org-acme get same "staging" sandbox
const staging1 = await getTeamSandbox('acme', 'staging');
const staging2 = await getTeamSandbox('acme', 'staging');

console.log(staging1.sandboxId === staging2.sandboxId); // true
```

### 3. Session Persistence

Reconnect to user's sandbox across app restarts:

```typescript
class UserSession {
  private sandbox: ProviderSandbox | null = null;

  async initialize(userId: string) {
    // Try to find existing sandbox first
    this.sandbox = await compute.sandbox.find({
      name: 'workspace',
      namespace: `user-${userId}`
    });

    if (!this.sandbox) {
      // Create new sandbox if none exists
      this.sandbox = await compute.sandbox.findOrCreate({
        name: 'workspace',
        namespace: `user-${userId}`,
        timeout: 3600000
      });
      console.log('Created new workspace');
    } else {
      console.log('Reconnected to existing workspace');
    }

    return this.sandbox;
  }
}
```

### 4. CI/CD Pipelines

Stable sandboxes per branch/PR:

```typescript
async function getCISandbox(repo: string, branch: string) {
  return await compute.sandbox.findOrCreate({
    name: `ci-${branch}`,
    namespace: repo,
    timeout: 60 * 60 * 1000 // 1 hour
  });
}

// PR sandboxes persist across CI runs
const prBox = await getCISandbox('my-org/my-repo', 'pr-123');
```

## Implementation Details

### Gateway Provider

Named sandboxes are implemented in the ComputeSDK gateway using a parent/subsandbox architecture:

1. Each unique `namespace` maps to a parent sandbox
2. Each `(namespace, name)` maps to a subsandbox within that parent
3. Gateway handles all mapping/cleanup automatically

**Storage:**
```
Redis:
  "sandbox:namespace:{workspace_id}:{namespace}" → parent_sandbox_id
  "sandbox:name:{workspace_id}:{namespace}:{name}" → subsandbox_id

Subsandbox metadata:
  - name
  - namespace
  - parent_sandbox_id
```

### Stale Mapping Cleanup

If a sandbox is destroyed externally (timeout, manual deletion, crash), the gateway automatically:
- Detects stale mappings on next `findOrCreate` or `find` call
- Removes invalid mappings
- Creates fresh sandbox on `findOrCreate`
- Returns `null` on `find`

### Provider Support

Currently supported providers:
- ✅ Gateway provider (via ComputeSDK edge)

Providers without support will throw:
```
Error: Provider 'e2b' does not support findOrCreate.
This feature requires gateway provider with named sandbox support.
```

## Requirements

- Gateway provider (auto-selected in zero-config mode)
- ComputeSDK edge gateway with PR #73 merged
- `COMPUTESDK_API_KEY` environment variable

## Migration Guide

### From UUID Tracking

**Before:**
```typescript
// You tracked sandbox IDs in your database
const sandboxId = await db.getSandboxId(userId, projectId);
let sandbox;

if (sandboxId) {
  sandbox = await compute.sandbox.getById(sandboxId);
}

if (!sandbox) {
  sandbox = await compute.sandbox.create();
  await db.saveSandboxId(userId, projectId, sandbox.sandboxId);
}
```

**After:**
```typescript
// Gateway handles mapping automatically
const sandbox = await compute.sandbox.findOrCreate({
  name: projectId,
  namespace: `user-${userId}`
});
```

### From Manual Cleanup

**Before:**
```typescript
// You manually cleaned up old sandbox references
const sandboxId = await db.getSandboxId(userId);
if (sandboxId) {
  try {
    sandbox = await compute.sandbox.getById(sandboxId);
  } catch (error) {
    // Sandbox died, clean up database
    await db.deleteSandboxId(userId);
  }
}
```

**After:**
```typescript
// Gateway auto-cleans stale mappings
const sandbox = await compute.sandbox.findOrCreate({
  name: 'workspace',
  namespace: `user-${userId}`
});
```

## Limitations

- Namespace/name mappings are workspace-scoped (different workspaces can reuse names)
- Maximum timeout depends on provider (gateway enforces provider limits)
- No timeout extension after creation (set long initial timeout instead)
- Requires gateway provider (not available with direct provider usage)

## See Also

- [Gateway Provider](../providers/gateway.md)
- [Sandbox API Reference](../reference/sandbox.md)
- [Usage Examples](../../examples/named-sandbox-example.ts)
