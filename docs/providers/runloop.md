# Runloop

Runloop provider for ComputeSDK - Execute code in cloud-based devboxes with full development environments.

## Installation

```bash
npm install @computesdk/runloop
```

## Usage

### With ComputeSDK

```typescript
import { createCompute } from 'computesdk';
import { runloop } from '@computesdk/runloop';

// Set as default provider
const compute = createCompute({ 
  provider: runloop({ apiKey: process.env.RUNLOOP_API_KEY }) 
});

// Create devbox
const sandbox = await compute.sandbox.create();

// Get instance
const instance = sandbox.getInstance();

// Execute commands
const result = await sandbox.runCommand('python', ['-c', 'print("Hello from Runloop!")']);
console.log(result.stdout); // "Hello from Runloop!"

// Clean up
await compute.sandbox.destroy(sandbox.sandboxId);
```

## Configuration

### Environment Variables

```bash
export RUNLOOP_API_KEY=your_runloop_api_key_here
```

### Configuration Options

```typescript
interface RunloopConfig {
  /** Runloop API key - if not provided, will use RUNLOOP_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## Snapshot Management

Create and restore devbox snapshots:

```typescript
// Create snapshot of current devbox state
const snapshot = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'after-setup',
  metadata: { 
    description: 'Devbox after initial setup and package installation',
    packages: ['numpy', 'pandas', 'flask']
  }
});

// Create new devbox from snapshot
const restoredSandbox = await compute.sandbox.create({
  options: { templateId: snapshot.id }
});

// List all snapshots
const snapshots = await compute.snapshot.list();

// Delete snapshot
await compute.snapshot.delete(snapshot.id);
```

## SDK Reference Links:

- **[Code Execution](https://www.computesdk.com/docs/reference/code-execution)** - Execute code snippets in various runtimes
- **[Command Execution](https://www.computesdk.com/docs/reference/code-execution#runcommand-method)** - Run shell commands and scripts
- **[Filesystem Operations](https://www.computesdk.com/docs/reference/filesystem)** - Read, write, and manage files in sandboxes
- **[Sandbox Management](https://www.computesdk.com/docs/reference/sandbox-management.md)** - Create, list, and destroy sandboxes
- **[Error Handling](https://www.computesdk.com/docs/reference/api-integration.md#error-handling)** - Handle command failures and runtime errors
- **[Web Framework Integration](https://www.computesdk.com/docs/reference/api-integration#web-framework-integration)** - Integrate with Express, Next.js, and other frameworks
