---
description: >-
  Set up the ASCII Box provider for ComputeSDK, configure your API key, and
  create cloud sandboxes to run commands and access the filesystem.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# ASCII Box

ASCII Box provider for ComputeSDK - cloud sandboxes with a full Linux environment, shell command execution, filesystem access, and port forwarding.

## Installation & Setup

```bash
npm install @computesdk/asciibox
```

Add your ASCII Box credentials to a `.env` file:

```bash
ASCIIBOX_API_KEY=your_ascii_box_api_key
```

ASCII Box API keys are also accepted via the `BOX_API_KEY` environment variable or the `apiKey` constructor option.

## Usage

```typescript
import { asciiBox } from '@computesdk/asciibox';

const compute = asciiBox({
  apiKey: process.env.ASCIIBOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from ASCII Box!"');
console.log(result.stdout); // "Hello from ASCII Box!"

// Filesystem access
await sandbox.filesystem.writeFile('/tmp/greeting.txt', 'hello');
const contents = await sandbox.filesystem.readFile('/tmp/greeting.txt');

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface AsciiBoxConfig {
  /** ASCII Box API key. Falls back to ASCIIBOX_API_KEY or BOX_API_KEY env var */
  apiKey?: string;
  /** ASCII Box API base URL. Defaults to https://ascii.dev/api/box/v1 */
  basePath?: string;
  /** Machine size: small, default, or large */
  type?: 'small' | 'default' | 'large';
  /** ASCII Box environment to attach */
  environment?: string;
}
```

## Features

- Create, list, get, and destroy ASCII Box sandboxes
- Run shell commands with `cwd`, environment variables, timeouts, and background support
- Read and write files and directories in the sandbox
- Expose sandbox ports via `getUrl`

## Limitations

- Snapshot and template (environment) lifecycle management must be done through the ASCII Box dashboard or CLI. The ComputeSDK `snapshot` and `template` managers are not registered for this provider, so those operations are unavailable through `compute.snapshot` and `compute.template`.
