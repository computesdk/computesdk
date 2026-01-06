# compute.sandbox


## Overview

Core methods for creating, destroying, listing, and retrieving sandbox instances.


## Prerequisites

### ComputeSDK API Key
```bash
COMPUTESDK_API_KEY=your_api_key_here
```

### Provider API Key / Environment Variables
```bash
PROVIDER_API_KEY=your_provider_api_key_here
```

### Install computesdk
```bash
npm install computesdk
```

<br/>
<br/>

---

## create(options?)

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

## destroy(sandboxId)

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

## getById(sandboxId)

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

## list()

**ℹ️ NOTE:** The `list()` method is currently not supported when using the gateway API (`import { compute } from 'computesdk'`). This functionality is actively being developed and will be available in a future release.

WIP: to retrieve a list of your active sandboxes from your provider, using ```compute.sandbox.list()```

**Alternative Approach:**
Until `list()` is available, you can **Track sandbox IDs locally**: Store sandbox IDs in your application (database, config, memory) and retrieve them using `getById()`