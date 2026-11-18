---
description: >-
  Tensorlake provider for ComputeSDK - Stateful MicroVM sandboxes for agentic
  applications and LLM-generated code execution.
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
tags:
  - tag: benchmarked
    primary: true
---

# Tensorlake

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/tensorlake/" %}

Tensorlake provider for ComputeSDK - Stateful MicroVM sandboxes for agentic applications and LLM-generated code execution.

## Lifecycle

Create with `{ ephemeral: false }` for pause/resume, which preserve memory and processes. Snapshot capabilities instead declare whole-rootfs **without** memory and keep the source. Restore with `snapshotId`; pause support does not imply memory snapshots.

## Installation & Setup

```bash
npm install @computesdk/tensorlake
```

Add your Tensorlake credentials to a `.env` file:

```bash
TENSORLAKE_API_KEY=your_tensorlake_api_key
```

## Usage

```typescript
import { tensorlake } from '@computesdk/tensorlake';

const compute = tensorlake({
  apiKey: process.env.TENSORLAKE_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Tensorlake!"');
console.log(result.stdout); // "Hello from Tensorlake!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface TensorlakeConfig {
  /** Tensorlake API key - if not provided, will use TENSORLAKE_API_KEY env var */
  apiKey?: string;
  /** Override for the management API base URL */
  apiUrl?: string;
  /** Override for the sandbox proxy URL */
  proxyUrl?: string;
  /** Default container image for new sandboxes (default: ubuntu-minimal) */
  image?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

### Standard sizes

`create({ sizeClass })` boots the exact standard profile with Tensorlake's native `cpus` / `memoryMb`, plus a 10240 MiB (10 GiB) root disk via `diskMb`:

| `sizeClass` | `cpus` | `memoryMb` | `diskMb` |
| --- | ---: | ---: | ---: |
| `xs` | 1 | 1024 | 10240 |
| `sm` | 1 | 2048 | 10240 |
| `md` | 2 | 4096 | 10240 |
| `lg` | 4 | 8192 | 10240 |
| `xl` | 8 | 16384 | 10240 |
| `2xl` | 16 | 32768 | 10240 |

- `3xl` (32 vCPU / 128 GiB) is `unsupported`: Tensorlake lists at most 16 vCPU / 64 GB per sandbox (Pro); Enterprise sizes are custom quotes.
- Your plan still caps what boots (Free: 1 vCPU / 1 GB; Usage Credits: 4 vCPU / 16 GB; Pro: 16 vCPU / 64 GB). A size above your plan fails at create with Tensorlake's limit error; it never falls back to the default 1 vCPU / 1 GiB.
- `sizeClass` with `snapshotId` is `unsupported`: a memory snapshot restore keeps the snapshot's CPU and memory.
- Combining `sizeClass` with `cpus`, `memoryMb`, `diskMb`, or `ephemeralDiskMb` throws `InstanceSizeError` with code `conflict`.

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
console.log(sandbox.sizing?.resolved); // { vcpus: 2, memoryMiB: 4096, diskMiB: 10240 }
```

### Sandbox Images

Tensorlake supports custom container images. The default is `ubuntu-minimal`:

```typescript
const sandbox = await compute.instances.create({ image: 'ubuntu-minimal' });
```

### Snapshots

Tensorlake supports snapshotting sandboxes for fast restores:

```typescript
// Create a snapshot from a running sandbox
const snapshot = await compute.snapshot.create(instanceId);

// Restore from a snapshot
const sandbox = await compute.instances.create({ snapshotId: snapshot.id });
```
