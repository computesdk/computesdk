---
description: >-
  Set up the Novita provider for ComputeSDK, configure your API key, and create
  sandboxes to run commands.
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

# Novita

Novita Sandbox provider for ComputeSDK, using the official `novita-sandbox` SDK.

## Installation & Setup

```bash
npm install @computesdk/novita
```

Requires Node.js 20 or later.

Set your Novita API key in the environment:

```bash
export NOVITA_API_KEY=your_novita_api_key
```

You can also add `NOVITA_API_KEY` to a `.env` file if your application loads it.
This is the only environment variable required to configure the provider.

## Usage

```typescript
import { novita } from '@computesdk/novita';

const compute = novita({
  apiKey: process.env.NOVITA_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

try {
  // Run a command
  const result = await sandbox.runCommand('echo "Hello from Novita!"');
  console.log(result.stdout); // "Hello from Novita!"
} finally {
  // Clean up
  await sandbox.destroy();
}
```

### Configuration Options

```typescript
interface NovitaConfig {
  /** Novita API key - if not provided, will use NOVITA_API_KEY env var */
  apiKey?: string;
  /** Default sandbox lifetime in milliseconds (default: 300000) */
  timeout?: number;
}
```

`novita({})` reads the API key from the environment. Set
`compute.sandbox.create({ timeout: 600_000 })` to override the default lifetime
for a sandbox. A command's `runCommand(..., { timeout })` is a separate deadline.

Create from a template with `templateId` or restore a snapshot with `snapshotId`.
These options are mutually exclusive; omitting both uses Novita's `base` template.
Creation also supports `envs`, `metadata`, `secure`, `allowInternetAccess`,
`network`, and `lifecycle`.

## Supported Operations

| Method | Notes |
| --- | --- |
| `compute.sandbox.create()` | Creates a sandbox from a template or snapshot. |
| `compute.sandbox.getById(id)` | Connects to a sandbox; returns `null` when it is not found. Connecting may resume a paused sandbox. |
| `compute.sandbox.list()` | Fetches all pages of running sandboxes and connects to each. Connections may extend sandbox lifetime. |
| `sandbox.destroy()` | Deletes the sandbox; succeeds if it is already gone. |
| `sandbox.runCommand()` | Supports `cwd`, `env`, `timeout`, background execution, and native `onStdout` / `onStderr` streaming. |
| `sandbox.getInfo()` | Reads current sandbox information from Novita. |
| `sandbox.getUrl({ port })` | Returns an HTTPS service URL by default. Service access may require a traffic token. |
| `sandbox.filesystem` | Supports `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, and `remove`. |
| `compute.snapshot` | Supports `create`, `list`, and `delete`. Creating a snapshot pauses its source sandbox; names and metadata are not supported. |
| `compute.template` | Supports `create`, `list`, and `delete`. Creation builds a default base image, a specified `image`, or a native `template` definition. |

Nonzero command exits return their output and exit code. Authentication, network,
and timeout errors reject the call. Background execution returns a launch
acknowledgement and cannot be combined with streaming callbacks.

Use `sandbox.getInstance()` to access the native Novita Sandbox, including PTY,
binary file operations, and provider-specific lifecycle methods. See the
[package README](../../packages/novita/README.md) for streaming, snapshot, and
template examples.
