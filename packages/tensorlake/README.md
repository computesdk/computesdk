# @computesdk/tensorlake

Tensorlake provider for ComputeSDK - stateful MicroVM sandboxes for agentic applications and LLM-generated code execution.

## Installation

```bash
npm install @computesdk/tensorlake
```

## Setup

1. Get your API key from [cloud.tensorlake.ai](https://cloud.tensorlake.ai)
2. Set the environment variable:

```bash
export TENSORLAKE_API_KEY=your_api_key_here
```

## Quick Start

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects Tensorlake from TENSORLAKE_API_KEY environment variable
const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('uname -a');
console.log(result.stdout);

await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { tensorlake } from '@computesdk/tensorlake';

const compute = tensorlake({ apiKey: process.env.TENSORLAKE_API_KEY });

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`uname -a`);

console.log(result.stdout);
await sandbox.destroy();
```

## Configuration

### Environment Variables

```bash
export TENSORLAKE_API_KEY=your_api_key_here
export TENSORLAKE_API_URL=https://api.tensorlake.ai   # optional override
```

### Configuration Options

```typescript
interface TensorlakeConfig {
  /** Tensorlake API key — falls back to TENSORLAKE_API_KEY environment variable */
  apiKey?: string;
  /** Override for the management API base URL */
  apiUrl?: string;
  /** Override for the sandbox proxy URL */
  proxyUrl?: string;
  /** Default container image for new sandboxes (default: ubuntu-minimal) */
  image?: string;
  /** Default timeout in seconds for sandboxes */
  timeout?: number;
}
```

## Features

- **Stateful MicroVMs** - Full VM isolation with persistent state within a session
- **Snapshot & restore** - Snapshot a running sandbox and resume from it later
- **Code execution** - Python and Node.js with auto-detection
- **Command execution** - Run shell commands, including background processes
- **Filesystem operations** - Read, write, list, and remove files and directories
- **URL access** - Expose sandbox ports via proxy URLs
- **Auto runtime detection** - Automatically detects Python vs Node.js from code patterns

## API Reference

### Sandbox Management

```typescript
// Create a sandbox (default image: ubuntu-minimal)
const sandbox = await compute.sandbox.create();

// Create with options
const sandbox = await compute.sandbox.create({
  image: 'ubuntu-minimal',
  timeout: 300000,         // ms → converted to seconds internally
  name: 'my-sandbox',
  snapshotId: 'snap-abc123', // resume from a snapshot
});

// Get an existing sandbox by ID
const sandbox = await compute.sandbox.getById('sandbox-id');

// List all running sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy a sandbox
await sandbox.destroy();
```

### Command Execution

```typescript
// Run a command and wait for output
const result = await sandbox.runCommand('ls -la /tmp');
console.log(result.stdout);
console.log(result.exitCode);

// Run with environment variables and working directory
const result = await sandbox.runCommand('npm install', {
  env: { NODE_ENV: 'production' },
  cwd: '/app',
});

// Fire-and-forget background process
await sandbox.runCommand('python server.py', { background: true });
```

### Filesystem Operations

```typescript
// Write a file
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello")');

// Read a file
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Create a directory (creates parents as needed)
await sandbox.filesystem.mkdir('/tmp/data/nested');

// List directory contents
const entries = await sandbox.filesystem.readdir('/tmp');
// entries: [{ name, type: 'file'|'directory', size, modified }]

// Check existence
const exists = await sandbox.filesystem.exists('/tmp/hello.py');

// Remove a file or directory
await sandbox.filesystem.remove('/tmp/hello.py');
```

### Snapshots

```typescript
// Snapshot the current state of a running sandbox
const snapshot = await compute.snapshot.create(sandboxId, { name: 'after-setup' });
console.log(snapshot.id); // 'snap-abc123'

// List all snapshots
const snapshots = await compute.snapshot.list();

// Delete a snapshot
await compute.snapshot.delete('snap-abc123');

// Resume from a snapshot
const sandbox = await compute.sandbox.create({ snapshotId: 'snap-abc123' });
```

### URL Access

```typescript
// Get a proxy URL for a port exposed inside the sandbox
const url = await sandbox.getUrl({ port: 443 });
// → "https://<sandbox-id>.sandbox.tensorlake.ai"

const customPortUrl = await sandbox.getUrl({ port: 8080 });
// → "https://8080-<sandbox-id>.sandbox.tensorlake.ai"

const wsUrl = await sandbox.getUrl({ port: 443, protocol: 'wss' });
// → "wss://<sandbox-id>.sandbox.tensorlake.ai"
```

## Examples

### Agentic Code Execution

```typescript
import { tensorlake } from '@computesdk/tensorlake';

const compute = tensorlake({ apiKey: process.env.TENSORLAKE_API_KEY });
const sandbox = await compute.sandbox.create({ timeout: 600000 });

// Install dependencies once
await sandbox.runCommand('pip install requests pandas');

const result = await sandbox.runCommand('python --version');
console.log(result.stdout);

await sandbox.destroy();
```

### Snapshot-Backed Warm Starts

```typescript
import { tensorlake } from '@computesdk/tensorlake';

const compute = tensorlake({ apiKey: process.env.TENSORLAKE_API_KEY });

// One-time setup: create a pre-warmed snapshot
async function createBaseSnapshot(): Promise<string> {
  const sandbox = await compute.sandbox.create();
  await sandbox.runCommand('pip install pandas numpy scikit-learn');
  const snapshot = await compute.snapshot.create(sandbox.sandboxId);
  await sandbox.destroy();
  return snapshot.id;
}

// Fast boot from snapshot — skips install step
const snapshotId = await createBaseSnapshot();
const sandbox = await compute.sandbox.create({ snapshotId });

const result = await sandbox.runCommand(`uname -a`);

console.log(result.stdout);
await sandbox.destroy();
```

## Error Handling

```typescript
import { tensorlake } from '@computesdk/tensorlake';

try {
  const compute = tensorlake({ apiKey: process.env.TENSORLAKE_API_KEY });
  const sandbox = await compute.sandbox.create();
  const result = await sandbox.runCommand('umane -a');
  console.log(result.stdout);
} catch (error) {
  if (error.message.includes('Missing Tensorlake API key')) {
    console.error('Set TENSORLAKE_API_KEY environment variable');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your API key at https://cloud.tensorlake.ai');
  } else {
    console.error(error);
  }
}
```

## Best Practices

1. **Snapshots for warm starts** - Snapshot after installing dependencies to avoid repeating setup
2. **Destroy sandboxes** - Always call `sandbox.destroy()` to release resources
3. **Set timeouts** - Use `timeout` on long-running workloads to avoid runaway VMs
4. **Background processes** - Use `{ background: true }` for servers or daemons; they survive after the initiating command returns
5. **API key security** - Never commit API keys; use environment variables or a secrets manager

## Support

- [Tensorlake Documentation](https://docs.tensorlake.ai)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
