---
description: >-
  Briq provider for ComputeSDK - sandboxes on microVMs with commands, files,
  previews and interactive processes.
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

# Briq

[Briq](https://briq.cloud) provider for ComputeSDK - sandboxes on microVMs with commands, files, previews and interactive processes.

## Installation & Setup

```bash
npm install @computesdk/briq
```

Create an API key on the **Agents** page of the [Briq dashboard](https://app.briq.cloud), then add it to a `.env` file:

```bash
BRIQ_API_KEY=your_briq_api_key
```

Node 22.6 or later is required.

## Usage

```typescript
import { briq } from '@computesdk/briq';

const compute = briq({
  apiKey: process.env.BRIQ_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Briq!"');
console.log(result.stdout);

// Clean up
await sandbox.destroy();
```

### Files

```typescript
await sandbox.filesystem.writeFile('/workspace/hello.txt', 'hi');
const text = await sandbox.filesystem.readFile('/workspace/hello.txt');
```

### Interactive processes

```typescript
const job = await sandbox.startProcess('cat', { stdin: true });
await job.write('hello\n');
await job.closeStdin();
console.log(await job.wait({ timeout: 5000 }));
```

### Preview URL

```typescript
const url = await sandbox.getUrl({ port: 3000 });
```

The URL is private: it carries its own credential. An instance has one preview, so a new port replaces the old one.

### Configuration Options

```typescript
interface BriqConfig {
  /** Briq API key - if not provided, will use BRIQ_API_KEY env var */
  apiKey?: string;
  /** API address - if not provided, will use BRIQ_API_URL, then https://api.briq.cloud */
  baseUrl?: string;
  /** Stack that holds the instances. Default "computesdk" */
  stack?: string;
  /** Custom HTTP transport. It must honor AbortSignal */
  fetch?: typeof fetch;
}
```

### Create options

| Option | Notes |
|---|---|
| `name` | Lowercase letters, digits and hyphens, 32 characters at most |
| `envs` | Stored encrypted by Briq |
| `metadata` | A JSON object, 1024 characters serialized |
| `directory` | Absolute working directory. Default `/workspace` |
| `signal` | Cancels creation |

Other options (`timeout`, `image`, templates, snapshots, `resources`, `sizeClass`, `volumes`, `egress`) are refused before anything is created.

## Limitations

- `runCommand` with `background: true` starts the command detached and returns exit code 0. Its output is discarded and it has no handle: use `startProcess` to read, wait for or stop a process. A detached command does not keep the instance awake; a long one needs a longer `sleep`.
- Command timeout is 30 seconds by default and one hour at most. Output is limited to 8 MiB.
- Files are UTF-8 text. Directory listings refuse symbolic links.
- No templates, snapshots or volumes.
- Instances run the Briq sandbox image, Linux amd64.
