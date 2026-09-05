# @computesdk/asciibox

ASCII Box provider for ComputeSDK - Execute code in cloud ASCII Box sandboxes with shell command execution, filesystem access, and port forwarding.

## Installation

```bash
npm install @computesdk/asciibox
```

## Setup

1. Get your ASCII Box API key from [ASCII Box settings](https://ascii.dev/box/settings/api-keys)
2. Set the environment variable:

```bash
export ASCIIBOX_API_KEY=your_ascii_box_api_key
```

The provider also accepts `BOX_API_KEY` and `BOX_BASE_URL` for compatibility with the official ASCII Box SDK.

## Quick Start

Configure `compute` with the ASCII Box provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { asciiBox } from '@computesdk/asciibox';

compute.setConfig({
  provider: asciiBox({ apiKey: process.env.ASCIIBOX_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "Hello from ASCII Box!"');
console.log(result.stdout);

await sandbox.destroy();
```

Alternatively, call the provider factory directly when you only need one provider:

```typescript
import { asciiBox } from '@computesdk/asciibox';

const sdk = asciiBox({ apiKey: process.env.ASCIIBOX_API_KEY });
const sandbox = await sdk.sandbox.create();
```

## Configuration

### Environment Variables

```bash
export ASCIIBOX_API_KEY=your_ascii_box_api_key
export ASCIIBOX_BASE_URL=https://ascii.dev/api/box/v1  # optional
```

### Configuration Options

```typescript
interface AsciiBoxConfig {
  /** ASCII Box API key. Falls back to ASCIIBOX_API_KEY or BOX_API_KEY env var */
  apiKey?: string;
  /** ASCII Box API base URL. Defaults to https://ascii.dev/api/box/v1 */
  basePath?: string;
  /** Machine size: small (2 vCPU / 4 GB), default (4 vCPU / 8 GB), or large (8 vCPU / 16 GB) */
  type?: 'small' | 'default' | 'large';
  /** ASCII Box environment to attach */
  environment?: string;
}
```

## Features

- **Command Execution** - Run shell commands with `cwd`, environment variables, timeout, and background support
- **Filesystem Operations** - Read, write, list, create, check, and remove files and directories
- **Port Forwarding** - Expose sandbox ports via `getUrl`
- **Sandbox Lifecycle** - Create, list, get by ID, and destroy sandboxes

## API Reference

### Command Execution

```typescript
const result = await sandbox.runCommand('ls -la');
console.log(result.stdout);

// With options
const result2 = await sandbox.runCommand('echo $GREETING', {
  env: { GREETING: 'hello' },
  cwd: '/tmp',
  timeout: 30000,
});
```

### Filesystem Operations

```typescript
// Write file
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello World');

// Read file
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');

// Create directory
await sandbox.filesystem.mkdir('/tmp/data');

// List directory
const entries = await sandbox.filesystem.readdir('/tmp');

// Check existence
const exists = await sandbox.filesystem.exists('/tmp/hello.txt');

// Remove file or directory
await sandbox.filesystem.remove('/tmp/data');
```

### Port Forwarding

```typescript
const url = await sandbox.getUrl({ port: 3000 });
```

## Limitations

- Snapshot and template (environment) lifecycle management are not supported through this provider. Use the ASCII Box dashboard or CLI to manage snapshots and environments.
