---
description: >-
  Sail provider for ComputeSDK - isolated Firecracker microVM sandboxes with
  fast startup, command execution, and native filesystem access.
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

# Sail

[Sail](https://sailresearch.com) provides maximally-efficient Firecracker microVM
sandboxes for running agent and developer workloads. They can live forever and bill only for active 
CPU, memory, and disk usage.

## Installation & Setup

```bash
npm install computesdk @computesdk/sail
```

Node.js 22 or newer is required. Create an API key at
[app.sailresearch.com](https://app.sailresearch.com), then export it:

```bash
export SAIL_API_KEY=your_sail_api_key
```

## Usage

```typescript
import { sail } from '@computesdk/sail';

const compute = sail({ app: 'my-app' });

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/result.txt', result.stdout);
console.log(await sandbox.filesystem.readFile('/tmp/result.txt'));

await sandbox.destroy();
```

## Configuration Options

```typescript
interface SailConfig {
  apiKey?: string;
  app?: string;
  image?: ImageSpec | Image;
}
```

`apiKey` falls back to `SAIL_API_KEY`. `app` falls back to `SAIL_APP`, then
`computesdk`, and is created on first use when missing. `image` defaults to
Sail's ARM64 Devbox builtin, which includes Node.js and Bun. Pass a different
image when the workload needs another runtime or architecture.

Create accepts Sailbox `size` values `s`, `m`, and `l`, optional `memoryGib`, a
name, and an `AbortSignal`. It defaults to `s`; explicit size choices override
that default. Unsupported universal options are rejected rather than silently
ignored.

## Supported Operations

| Method | Supported | Notes |
|---|---|---|
| `create` | Yes | Defaults to an ARM64 Devbox on `S`. |
| `getById` | Yes | Returns `null` for missing or terminated Sailboxes. |
| `list` | Yes | Lists live and actionable Sailboxes for the configured app. |
| `destroy` | Yes | Terminates the Sailbox. |
| `runCommand` | Yes | Supports cwd, environment, timeout, and background mode. |
| `getInfo` | Yes | Maps current Sail lifecycle state to ComputeSDK. |
| `getUrl` | Yes | Supports public HTTP/HTTPS and TCP listeners. |
| `filesystem` | Yes | Native read, write, mkdir, list, exists, and remove. |
| Templates | No | Configure a Sail `Image` on the provider. |
| Snapshots | No | Use the native Sail SDK for checkpoints. |

`getUrl` preserves existing listener policy and rejects protocol conflicts
instead of replacing a listener's allowlist.

Use `sandbox.getInstance()` for Sail-specific checkpoint, sleep, resume, SSH,
listener allowlist, and credential-injection APIs.
