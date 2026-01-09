# compute.sandbox


## Overview

Core methods for creating, destroying, listing, and retrieving sandbox instances.


---

## `create(options?)`

Create a new compute sandbox instance with auto-detected provider configuration.

**Parameters:**

- `options` (CreateSandboxOptions, optional): Configuration options for sandbox creation
  - `timeout` (number, optional): Sandbox execution timeout in milliseconds
  - `templateId` (string, optional): Provider-specific template or image identifier
  - `metadata` (Record<string, any>, optional): Custom metadata to attach to the sandbox
  - `envs` (Record<string, string>, optional): Environment variables to set in the sandbox
  - `name` (string, optional): Unique identifier for named sandbox functionality
  - `namespace` (string, optional): Isolation scope for named sandboxes (defaults to "default")

**Returns:** `Promise<Sandbox>` - New sandbox instance ready for code execution and commands

**Sandbox instance properties:**
- `sandboxId` (string): Unique identifier for the sandbox
- `provider` (string): Provider hosting the sandbox (e.g., 'e2b', 'modal', 'vercel')
- `filesystem` (SandboxFileSystem): File system operations interface
- Core methods: `runCode()`, `runCommand()`, `getInfo()`, `getUrl()`, `destroy()`
- Advanced features: `terminal`, `run`, `server`, `watcher`, `env`, `file`, and more
- See [Sandbox API Reference](./Sandbox.md) for complete interface documentation

**CreateSandboxOptions interface:**
```typescript
{
  timeout?: number;               // Execution timeout in milliseconds
  templateId?: string;            // Provider template/image identifier
  metadata?: Record<string, any>; // Custom metadata
  envs?: Record<string, string>;  // Environment variables
  name?: string;                  // Named sandbox identifier
  namespace?: string;             // Named sandbox namespace
}
```

**Examples:**

```typescript
import { compute } from 'computesdk';

// Basic sandbox creation (auto-detects provider)
const sandbox = await compute.sandbox.create();
console.log(sandbox.sandboxId);  // "sb_abc123..."
console.log(sandbox.provider);   // "e2b"

// With timeout (30 minutes)
const sandbox = await compute.sandbox.create({
  timeout: 30 * 60 * 1000
});

// With environment variables
const sandbox = await compute.sandbox.create({
  envs: {
    API_KEY: 'your-api-key',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://...'
  }
});

// With provider template/image
const sandbox = await compute.sandbox.create({
  templateId: 'your-template-id'
});

// With custom metadata
const sandbox = await compute.sandbox.create({
  metadata: {
    userId: 'user-123',
    projectId: 'proj-456',
    environment: 'staging'
  }
});

// With multiple options combined
const sandbox = await compute.sandbox.create({
  timeout: 60 * 60 * 1000,  // 1 hour
  templateId: 'your-template-id',
  envs: {
    NODE_ENV: 'production',
    DEBUG: 'true'
  },
  metadata: {
    owner: 'team-backend',
    purpose: 'integration-tests'
  }
});

// Error handling - missing configuration
try {
  const sandbox = await compute.sandbox.create();
} catch (error) {
  console.error('Failed to create sandbox:', error.message);
  // Error: No ComputeSDK configuration found.
  // Set COMPUTESDK_API_KEY and provider credentials
}
```

**Notes:**
- Provider is auto-detected from environment variables when `COMPUTESDK_API_KEY` is set with provider-specific credentials
- Each call creates a new sandbox instance with a unique `sandboxId`
- The `timeout` option sets maximum sandbox lifetime; sandboxes auto-terminate after this period
- The `templateId` parameter is provider-specific (refers to templates, images, or runtime environments)
- Environment variables set via `envs` are available to all commands and code executed in the sandbox
- Throws an error if ComputeSDK is not configured (missing API key or provider credentials)

<br/>
<br/>

---

## `destroy(sandboxId)`

Destroy a sandbox and clean up all associated resources.

**Parameters:**

- `sandboxId` (string, required): Unique identifier of the sandbox to destroy

**Returns:** `Promise<void>` - Resolves when sandbox is successfully destroyed

> **⚠️ CAUTION:** Destroying a sandbox is a permanent operation. All data, files, and running processes in the sandbox will be irreversibly deleted.

**Examples:**

```typescript
import { compute } from 'computesdk';

// Basic cleanup after use
const sandbox = await compute.sandbox.create();
// ... use sandbox ...
await compute.sandbox.destroy(sandbox.sandboxId);

// Destroy sandbox by stored ID
const sandboxId = 'sb_abc123...';
await compute.sandbox.destroy(sandboxId);

// Batch cleanup - destroy multiple sandboxes
const sandboxIds = ['sb_123...', 'sb_456...', 'sb_789...'];
await Promise.all(sandboxIds.map(id => compute.sandbox.destroy(id)));

// With error handling
try {
  await compute.sandbox.destroy(sandbox.sandboxId);
  console.log('Sandbox destroyed successfully');
} catch (error) {
  console.error('Failed to destroy sandbox:', error.message);
}

// Best practice: ensure cleanup with finally block
let sandbox;
try {
  sandbox = await compute.sandbox.create();
  await sandbox.runCode('console.log("Hello")');
} finally {
  if (sandbox) {
    await compute.sandbox.destroy(sandbox.sandboxId);
  }
}
```

**Notes:**
- Destroying a sandbox terminates all running processes and releases all allocated resources
- This operation is idempotent - calling destroy on an already-destroyed sandbox succeeds without error
- Best practice: Use `finally` blocks or cleanup handlers to ensure sandboxes are destroyed even if errors occur
- All sandbox data and files are permanently lost after destruction

<br/>
<br/>

---

## `getById(sandboxId)`

Retrieve an existing sandbox instance by its unique identifier.

**Parameters:**

- `sandboxId` (string, required): Unique identifier of the sandbox to retrieve

**Returns:** `Promise<Sandbox | null>` - Sandbox instance if found, or `null` if the sandbox doesn't exist

**Sandbox instance properties:**
- `sandboxId` (string): Unique identifier for the sandbox
- `provider` (string): Provider hosting the sandbox
- `filesystem` (SandboxFileSystem): File system operations interface
- Core methods: `runCode()`, `runCommand()`, `getInfo()`, `getUrl()`, `destroy()`
- Advanced features: `terminal`, `run`, `server`, `watcher`, `env`, `file`, and more
- See [Sandbox API Reference](./Sandbox.md) for complete interface documentation

**Examples:**

```typescript
import { compute } from 'computesdk';

// Reconnect to existing sandbox by ID
const sandboxId = 'sb_abc123...';
const sandbox = await compute.sandbox.getById(sandboxId);

if (sandbox) {
  const result = await sandbox.runCode('console.log("Reconnected!")');
  console.log(result.output);  // "Reconnected!"
}

// Store ID and reconnect later
// Step 1: Create and store ID
const newSandbox = await compute.sandbox.create();
const storedId = newSandbox.sandboxId;
// Store storedId in database, config file, etc.

// Step 2: Later, retrieve using stored ID
const retrievedSandbox = await compute.sandbox.getById(storedId);
if (retrievedSandbox) {
  await retrievedSandbox.runCommand('npm install');
}

// Check if sandbox exists before using
const sandbox = await compute.sandbox.getById(sandboxId);

if (sandbox === null) {
  console.log('Sandbox not found - creating new one');
  const newSandbox = await compute.sandbox.create();
} else {
  console.log('Sandbox found - using existing one');
  await sandbox.runCode('print("Still active!")');
}

// Graceful handling of missing sandbox
const sandboxId = 'sb_might_not_exist...';
const sandbox = await compute.sandbox.getById(sandboxId);

if (sandbox) {
  // Sandbox exists - use it
  await sandbox.runCommand('npm test');
  console.log('Tests completed on existing sandbox');
} else {
  // Sandbox not found - handle accordingly
  console.log('Sandbox no longer exists');
}
```

**Notes:**
- Returns `null` for non-existent or destroyed sandboxes (does not throw errors)
- Retrieved sandboxes have full functionality identical to newly created sandboxes
- Useful for reconnecting to long-lived sandboxes or implementing persistent sandbox patterns
- Sandbox IDs can be stored and used to reconnect later across application restarts

<br/>
<br/>

---

## `list()`

**ℹ️ NOTE:** The `list()` method is currently not supported when using the gateway API (`import { compute } from 'computesdk'`). This functionality is actively being developed and will be available in a future release.

WIP: to retrieve a list of your active sandboxes from your provider, using ```compute.sandbox.list()```

**Alternative Approach:**
Until `list()` is available, you can **Track sandbox IDs locally**: Store sandbox IDs in your application (database, config, memory) and retrieve them using `getById()`

<br/>
<br/>

---

## `findOrCreate(options)`

Find an existing named sandbox or create a new one if it doesn't exist. Named sandboxes provide persistent, reusable sandbox instances identified by `(namespace, name)` pairs.

**Parameters:**

- `options` (FindOrCreateSandboxOptions, required): Configuration for finding or creating the sandbox
  - `name` (string, required): Unique identifier for the sandbox within its namespace
  - `namespace` (string, optional): Isolation scope for the sandbox (defaults to "default")
  - `timeout` (number, optional): Sandbox execution timeout in milliseconds (only used when creating)
  - `templateId` (string, optional): Provider-specific template identifier (only used when creating)
  - `metadata` (Record<string, any>, optional): Custom metadata (only used when creating)
  - `envs` (Record<string, string>, optional): Environment variables (only used when creating)

**Returns:** `Promise<Sandbox>` - Existing sandbox if found by name, or newly created sandbox if not found

**FindOrCreateSandboxOptions interface:**
```typescript
{
  name: string;                   // Required: Unique sandbox identifier
  namespace?: string;             // Optional: Defaults to "default"
  timeout?: number;               // Used only when creating
  templateId?: string;            // Used only when creating
  metadata?: Record<string, any>; // Used only when creating
  envs?: Record<string, string>;  // Used only when creating
}
```

**Examples:**

```typescript
import { compute } from 'computesdk';

// Basic usage - find or create by name
const sandbox = await compute.sandbox.findOrCreate({
  name: 'my-dev-sandbox'
});
console.log(sandbox.sandboxId);  // Consistent ID for "my-dev-sandbox"

// With custom namespace for isolation
const sandbox = await compute.sandbox.findOrCreate({
  name: 'build-env',
  namespace: 'project-123'
});
// Creates/finds sandbox uniquely identified by (project-123, build-env)

// With creation options (used only if sandbox doesn't exist)
const sandbox = await compute.sandbox.findOrCreate({
  name: 'ci-runner',
  namespace: 'github-actions',
  timeout: 60 * 60 * 1000,  // 1 hour (only applied to new sandboxes)
  envs: {
    NODE_ENV: 'test',
    CI: 'true'
  },
  metadata: {
    workflow: 'test-suite',
    branch: 'main'
  }
});


// Multi-tenant isolation with namespaces
const tenant1Sandbox = await compute.sandbox.findOrCreate({
  name: 'app-instance',
  namespace: 'tenant-abc'  // Isolated to tenant-abc
});

const tenant2Sandbox = await compute.sandbox.findOrCreate({
  name: 'app-instance',
  namespace: 'tenant-xyz'  // Isolated to tenant-xyz
});
// Both use same name but are separate sandboxes due to different namespaces
```

**Notes:**
- **Idempotent operation**: Safe to call multiple times - always returns the same sandbox for a given `(namespace, name)` pair
- The `namespace` defaults to `"default"` if not specified
- Creation options (`timeout`, `templateId`, `metadata`, `envs`) are only applied when creating a new sandbox
- If the sandbox already exists, creation options are ignored and the existing sandbox is returned as-is
- Named sandboxes persist until explicitly destroyed with `destroy(sandboxId)`
- Useful for implementing persistent workspaces, shared environments, or CI/CD build caches
- The returned Sandbox instance includes `name` and `namespace` in its metadata

<br/>
<br/>

---

## `find(options)`

Find an existing named sandbox without creating a new one if it doesn't exist.

**Parameters:**

- `options` (FindSandboxOptions, required): Configuration for finding the sandbox
  - `name` (string, required): Unique identifier for the sandbox within its namespace
  - `namespace` (string, optional): Isolation scope for the sandbox (defaults to "default")

**Returns:** `Promise<Sandbox | null>` - Existing sandbox if found by name, or `null` if not found

**FindSandboxOptions interface:**
```typescript
{
  name: string;       // Required: Unique sandbox identifier
  namespace?: string; // Optional: Defaults to "default"
}
```

**Examples:**

```typescript
import { compute } from 'computesdk';

// Basic usage - find by name
const sandbox = await compute.sandbox.find({
  name: 'my-dev-sandbox'
});

if (sandbox) {
  console.log('Found existing sandbox:', sandbox.sandboxId);
  await sandbox.runCommand('ls -la');
} else {
  console.log('Sandbox not found');
}

// Find with custom namespace
const sandbox = await compute.sandbox.find({
  name: 'build-env',
  namespace: 'project-123'
});

// Cleanup check - find before destroying
const toCleanup = await compute.sandbox.find({
  name: 'temp-environment',
  namespace: 'staging'
});

if (toCleanup) {
  await compute.sandbox.destroy(toCleanup.sandboxId);
  console.log('Cleaned up temporary environment');
}
```

**Notes:**
- Returns `null` if no sandbox exists with the given `(namespace, name)` pair (does not throw errors)
- The `namespace` defaults to `"default"` if not specified
- Does not create a new sandbox - read-only lookup operation
- Use this when you want to check for existence without automatically creating
- More explicit than `findOrCreate()` when you need different handling for found vs not-found cases

<br/>
<br/>

---

## `extendTimeout(sandboxId, options?)`

Extend the timeout/TTL (time-to-live) for an existing sandbox to prevent automatic shutdown.

**Parameters:**

- `sandboxId` (string, required): Unique identifier of the sandbox to extend
- `options` (ExtendTimeoutOptions, optional): Extension configuration
  - `duration` (number, optional): Extension duration in milliseconds (default: 900000 = 15 minutes)

**Returns:** `Promise<void>` - Resolves when timeout is successfully extended

**ExtendTimeoutOptions interface:**
```typescript
{
  duration?: number;  // Extension duration in milliseconds (default: 15 minutes)
}
```

**Examples:**

```typescript
import { compute } from 'computesdk';

// Basic timeout extension (default: 15 minutes)
const sandbox = await compute.sandbox.create();
await compute.sandbox.extendTimeout(sandbox.sandboxId);
console.log('Sandbox lifetime extended by 15 minutes');

// Custom extension duration (1 hour)
await compute.sandbox.extendTimeout(sandbox.sandboxId, {
  duration: 60 * 60 * 1000  // 3600000 ms = 1 hour
});


// Long-running task with periodic extensions
async function longRunningBuild(sandbox: Sandbox) {
  const extendEvery = 20 * 60 * 1000;  // 20 minutes
  const extendBy = 30 * 60 * 1000;      // 30 minutes

  const keepAlive = setInterval(async () => {
    await compute.sandbox.extendTimeout(sandbox.sandboxId, {
      duration: extendBy
    });
  }, extendEvery);

  try {
    await sandbox.runCommand('npm run build:production');
    console.log('Build completed successfully');
  } finally {
    clearInterval(keepAlive);
  }
}

```

**Notes:**
- Default extension duration is 15 minutes (900000 milliseconds)
- Extends the maximum lifetime of the sandbox from the current time
- Does not restart or reset the sandbox - only prevents automatic shutdown
- Can be called multiple times to keep extending as needed
- Useful for long-running operations like large builds, extensive test suites, or data processing
- The sandbox will still shut down when explicitly destroyed with `destroy()`
