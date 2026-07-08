# @computesdk/lightning

Lightning AI provider for ComputeSDK - create and manage [Lightning AI](https://lightning.ai/) sandboxes: run shell commands, read/write files, and manage the sandbox lifecycle.

## Installation

```bash
npm install @computesdk/lightning
```

> **Note**
> The underlying `@lightningai/sdk` is published ESM-only and requires **Node.js 22+**. This package loads it via dynamic `import()`, so it works from both ESM and CommonJS projects (running on Node 22+).

## Setup

1. Get your API key from your [Lightning AI](https://lightning.ai/) account settings.
2. Set the environment variable:

```bash
export LIGHTNING_API_KEY=your_api_key_here
```

## Quick Start

Configure `compute` with the Lightning provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { lightning } from '@computesdk/lightning';

compute.setConfig({
  provider: lightning({ apiKey: process.env.LIGHTNING_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "Hello from Lightning"');
console.log(result.stdout);

await sandbox.destroy();
```

Alternatively, call the provider factory directly when you only need one provider:

```typescript
import { lightning } from '@computesdk/lightning';

const sdk = lightning({ apiKey: process.env.LIGHTNING_API_KEY });
const sandbox = await sdk.sandbox.create();
```

## Configuration

### Environment Variables

```bash
export LIGHTNING_API_KEY=your_api_key_here
# Optional: override the Lightning Cloud base URL
export LIGHTNING_CLOUD_URL=https://lightning.ai
```

`LIGHTNING_SANDBOX_API_KEY` is also accepted (and takes precedence over `LIGHTNING_API_KEY`, matching the SDK).

### Configuration Options

```typescript
interface LightningConfig {
  /** Lightning AI API key - falls back to LIGHTNING_API_KEY / LIGHTNING_SANDBOX_API_KEY */
  apiKey?: string;
  /** Lightning Cloud base URL - falls back to LIGHTNING_CLOUD_URL, then production */
  baseUrl?: string;
  /** Instance type for new sandboxes (e.g. "cpu-1" ... "cpu-16"). Defaults to "cpu-1" */
  instanceType?: string;
  /** Curated runtime image (e.g. "node24", "python313") */
  runtime?: string;
  /** Persist filesystem state across stops via auto-snapshots */
  persistent?: boolean;
  /** Request spot capacity */
  spot?: boolean;
  /** Ports to expose on new sandboxes */
  ports?: number[];
  /** Maximum sandbox lifetime in milliseconds before auto-stop */
  timeout?: number;
}
```

## Features

- ✅ **Command Execution** - Run shell commands inside the sandbox
- ✅ **Filesystem Operations** - Read/write files, directories, and listing via the Lightning SDK
- ✅ **Sandbox Lifecycle** - Create, reconnect by id, list, and destroy sandboxes
- ✅ **Port URLs** - `getUrl(port)` returns the public HTTPS URL for any port declared at create time
- ✅ **Snapshots** - Capture, list, delete, and restore filesystem snapshots via `compute.snapshot.*`

## Snapshots

Capture a sandbox's filesystem, list/delete snapshots, and boot a new sandbox from one:

```typescript
import { compute } from 'computesdk';
import { lightning } from '@computesdk/lightning';

compute.setConfig({ provider: lightning() });

const sandbox = await compute.sandbox.create();

// Capture (waits until the snapshot is `ready`)
const snapshot = await compute.snapshot.create(sandbox.sandboxId);

// List (optionally scoped to a source sandbox)
const snapshots = await compute.snapshot.list({ sandboxId: sandbox.sandboxId });

// Restore into a fresh sandbox
const restored = await compute.sandbox.create({ snapshotId: snapshot.id });

// Delete
await compute.snapshot.delete(snapshot.id);
```

> Lightning snapshots are unnamed, so `CreateSnapshotOptions.name` / `metadata` are accepted for API parity but not persisted. `/tmp` (and other platform defaults) are excluded from snapshots — persist data under `$HOME` to have it survive a restore.

## API Reference

### Command Execution

```typescript
// Run a shell command
const result = await sandbox.runCommand('ls -la');
console.log(result.stdout, result.exitCode);

// Run with a working directory and environment variables
const result = await sandbox.runCommand('node script.js', {
  cwd: '/workspace',
  env: { NODE_ENV: 'production' },
});

// Background a long-running command
await sandbox.runCommand('python server.py', { background: true });
```

> **Note**
> Lightning returns a single combined stdout/stderr stream, which ComputeSDK surfaces on `result.stdout` (`result.stderr` is left empty).

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello World');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory contents
const files = await sandbox.filesystem.readdir('/tmp');

// Check if a path exists
const exists = await sandbox.filesystem.exists('/tmp/hello.txt');

// Remove a file or directory
await sandbox.filesystem.remove('/tmp/hello.txt');
```

### Sandbox Management

```typescript
// Get sandbox info
const info = await sandbox.getInfo();
console.log(info.id, info.status, info.createdAt);

// Reconnect to an existing sandbox by id
const existing = await sdk.sandbox.getById('sandbox-id');

// List sandboxes
const sandboxes = await sdk.sandbox.list();

// Destroy sandbox
await sandbox.destroy();

// Drop down to the native @lightningai/sdk Sandbox instance
const native = sandbox.getInstance();
```

## Error Handling

```typescript
import { lightning } from '@computesdk/lightning';

try {
  const sdk = lightning({ apiKey: process.env.LIGHTNING_API_KEY });
  const sandbox = await sdk.sandbox.create();
  const result = await sandbox.runCommand('echo hi');
} catch (error) {
  if (error.message.includes('Missing Lightning AI API key')) {
    console.error('Set LIGHTNING_API_KEY environment variable');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your Lightning AI API key');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Lightning AI usage limits reached');
  }
}
```

## Limitations

- **Node.js 22+** is required by the underlying `@lightningai/sdk`.
- **Port URLs**: `getUrl(port)` returns Lightning's public HTTPS URL for a port (e.g. `https://8080-<sandbox-id>-s.cloudspaces.litng.ai`). The port must be declared via `ports` at create time, otherwise `getUrl` throws.
- **Combined output**: stdout and stderr are returned as a single combined stream on `result.stdout`.

## Support

- [Lightning AI Sandbox Docs](https://lightning.ai/docs/platform/developers/sdk/sandbox)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
