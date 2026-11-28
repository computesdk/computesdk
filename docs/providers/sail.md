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

## Lifecycle

`pause()`/`resume()` preserve memory and processes. `snapshot.create()` uses a checkpoint, preserves rootfs (including `/tmp`) and memory, and leaves the source running. `instances.create({ snapshotId })` starts a new Sailbox from that checkpoint.

Create-time `timeout` is rejected: Sail does not expose a hard sandbox lifetime through this adapter. Bound commands with `runCommand(..., { timeout })` and destroy the sandbox when finished. A checkpoint restore retains the source's resources, so do not combine `snapshotId` with `size` or `memoryGib`.

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

const sandbox = await compute.instances.create();
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
  region?: 'us-west' | 'us-east';
}
```

`apiKey` falls back to `SAIL_API_KEY`. `app` falls back to `SAIL_APP`, then
`computesdk`, and is created on first use when missing. `image` defaults to
Sail's ARM64 Devbox builtin, which includes Node.js and Bun. Pass a different
image when the workload needs another runtime or architecture.

`region` is the Sail region new Sailboxes are created in, such as
`sail({ region: 'us-east' })`. Sail's regions are `us-west` (the default) and
`us-east`. Choose the region closest to your client to lower command and file
latency. When omitted, Sail uses its default region. A Sailbox stays in its
region for its whole life, and a `snapshotId` restore does not take a region.

Create accepts a standard `sizeClass`, Sail's `vcpuCount` (1 to 64), the
deprecated Sailbox `size` values `s`, `m`, and `l`, optional `memoryGib`, a
name, and an `AbortSignal`. Without explicit sizing, it inherits the image's
resource limits (8 vCPUs and 64 GiB by default). `vcpuCount`, `size` and
`memoryGib` are sent only when explicitly supplied; `vcpuCount` and `size`
cannot be combined. Unsupported universal options are rejected rather than
silently ignored.

## Standard sizes

`sizeClass` sets the Sailbox's per-create `vcpuCount` and memory limit
(`memoryLimitGib`). Sail rounds both up to a power of two and raises any memory
limit below 16 GiB to 16 GiB, so every Sailbox holds at least 16 GiB and the
resolved memory is larger than the standard size for `sm` through `xl`:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
console.log(sandbox.sizing.resolved); // { vcpus: 2, memoryMiB: 16384 }
```

| `sizeClass` | Sail limits | Resolved shape |
| --- | --- | --- |
| `xs` | `vcpuCount: 1`, 16 GiB | 1 vCPU / 16384 MiB (Sail's 16 GiB floor) |
| `sm` | `vcpuCount: 1`, 16 GiB | 1 vCPU / 16384 MiB |
| `md` | `vcpuCount: 2`, 16 GiB | 2 vCPU / 16384 MiB |
| `lg` | `vcpuCount: 4`, 16 GiB | 4 vCPU / 16384 MiB |
| `xl` | `vcpuCount: 8`, 16 GiB | 8 vCPU / 16384 MiB |
| `2xl` | `vcpuCount: 16`, 32 GiB | 16 vCPU / 32768 MiB |
| `3xl` | `vcpuCount: 32`, 64 GiB | 32 vCPU / 65536 MiB |

These are limits, not reserved resources: Sail bills the CPU and memory the
Sailbox actually uses. Disk keeps the image's limit (256 GiB by default).
`sizeClass` cannot be combined with `vcpuCount`, `memoryGib`, `memoryLimitGib`
or `size` (`InstanceSizeError` code `conflict`), and is `unsupported` with
`snapshotId`, because a checkpoint restore keeps the checkpoint's limits.

## Supported Operations

| Method | Supported | Notes |
|---|---|---|
| `create` | Yes | Defaults to an ARM64 Devbox with the image's resource limits. |
| `getById` | Yes | Returns `null` for missing or terminated Sailboxes. |
| `list` | Yes | Lists live and actionable Sailboxes for the configured app. |
| `destroy` | Yes | Terminates the Sailbox. |
| `runCommand` | Yes | Supports cwd, environment, timeout, and background mode. |
| `getInfo` | Yes | Maps current Sail lifecycle state to ComputeSDK. |
| `getUrl` | Yes | Supports public HTTP/HTTPS and TCP listeners. |
| `filesystem` | Yes | Native read, write, mkdir, list, exists, and remove. |
| Templates | No | Configure a Sail `Image` on the provider. |
| Snapshots | Yes | Unified create/list/delete use Sail checkpoints; restore with `snapshotId`. |

`getUrl` preserves existing listener policy and rejects protocol conflicts
instead of replacing a listener's allowlist.

Use `sandbox.getInstance()` for Sail-specific SSH,
listener allowlist, and credential-injection APIs.
