---
description: >-
  Sandock provider for ComputeSDK - Docker-based sandboxes for AI agents, with
  streaming output, filesystem access and preview URLs.
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

# Sandock

[Sandock](https://sandock.ai) provider for ComputeSDK - Docker-based sandboxes for AI agents. Each sandbox runs a Docker image of your choice, with streaming command output, filesystem access and preview URLs for ports.

## Installation & Setup

```bash
npm install @computesdk/sandock
```

Add your Sandock API key to a `.env` file:

```bash
SANDOCK_API_KEY=your_sandock_api_key
```

Get a key from your account at [sandock.ai](https://sandock.ai).

Two more variables are optional. `SANDOCK_SPACE_ID` creates and looks up sandboxes in a team space instead of your personal space. `SANDOCK_BASE_URL` picks the API to use (default `https://sandock.ai`).

## Usage

```typescript
import { sandock } from '@computesdk/sandock';

const compute = sandock({
  apiKey: process.env.SANDOCK_API_KEY,
});

// Create a sandbox from the default image
// (pass { image: 'python:3.12-slim' } to use any Docker image)
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Sandock!"');
console.log(result.stdout); // "Hello from Sandock!"

// Stream a command's output while it runs
await sandbox.runCommand('for i in 1 2 3; do echo "step $i"; sleep 1; done', {
  onStdout: (text) => process.stdout.write(text),
});

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
console.log(await sandbox.filesystem.readFile('/tmp/hello.py'));

// Reach a server in the sandbox
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
console.log(await sandbox.getUrl({ port: 3000 }));

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface SandockConfig {
  /** Sandock API key - if not provided, will use SANDOCK_API_KEY env var */
  apiKey?: string;
  /** Sandock API URL - if not provided, will use SANDOCK_BASE_URL, then https://sandock.ai */
  baseUrl?: string;
  /** Space to create and look up sandboxes in - if not provided, will use SANDOCK_SPACE_ID, then your personal space */
  spaceId?: string;
  /** Docker image create() uses when it names none. Default: 'sandockai/sandock-code:latest' */
  image?: string;
  /** Sandbox lifetime in milliseconds when create() sets none. Default: 30 minutes, max 24 hours */
  timeout?: number;
  /** Bound on a command that sets no timeout, in milliseconds. Default: 300000 (5 minutes) */
  commandTimeout?: number;
  /** CPU shares for new sandboxes */
  cpu?: number;
  /** Memory limit for new sandboxes, in MB */
  memory?: number;
  /** Minutes until a stopped sandbox is deleted (-1: never, 0: at once). Default: 1 day */
  autoDeleteInterval?: number;
}
```

### Create options

`image` (or `templateId`) names the Docker image to run. The default image, `sandockai/sandock-code`, ships Node.js, Python and the usual shell tools. `create()` also takes `timeout` (the sandbox lifetime; a sandbox that reaches it is stopped), `envs`, `name` (the sandbox title shown in the Sandock dashboard), `cpu` and `memory`.

## Supported features

Commands take `cwd`, `env`, `timeout` and `background`, and a non-zero exit comes back as the result's `exitCode`. With `onStdout` or `onStderr`, output streams while the command runs, over Sandock's own streaming API; a command that outruns its `timeout` is stopped and reported with exit code 124.

The filesystem API covers reading, writing and listing files, creating directories, checking a path and removing it. `create`, `getById`, `list` and `destroy` manage sandboxes. `getUrl({ port })` returns a signed preview URL for the port, with the access token embedded so it can be opened directly; it is valid for an hour. `sandbox.getInstance()` returns the sandbox id, the `sandock` SDK client and the provider config, for what the SDK offers beyond the ComputeSDK interface.

## Limitations

- Sandock has no snapshots, so `create({ snapshotId })` throws; Sandock templates are Docker images.
- The output of a `background: true` command is not collected.
- `getById` and `getInfo` look the sandbox up in the space's sandbox list, so they take longer in a space with many sandboxes.
- Files are read and written as UTF-8 text.
