---
description: >-
  Use Beam with ComputeSDK to create sandboxes with token and workspace
  authentication, then run commands with configurable gateway and timeout
  settings.
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

# Beam

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/beam/" %}

Beam provider for ComputeSDK

## Standard sizes

`instances.create({ sizeClass })` maps every standard size to its exact profile through beam-js `cpu` (cores) and `memory` (MiB): `xs` 1/1024, `sm` 1/2048, `md` 2/4096, `lg` 4/8192, `xl` 8/16384, `2xl` 16/32768, `3xl` 32/131072. Beam's default Performance tier takes arbitrary CPU and memory (beam-js accepts 0.1–64 cores). No disk is set.

- Native `cpu` or `memory` with `sizeClass` is a `conflict`.
- `snapshotId` (checkpoint restore) and `sandboxId` are `unsupported`: the restore keeps the checkpoint's resources.
- `cpuTier: 'shared'` caps at 8 vCPU / 16 GiB, so `2xl` and `3xl` are `unsupported` there.
- `gpu`, `gpuCount` or `pool` placement is `unknown`: Beam lists no CPU/RAM limits for it.

See [Sandbox sizes](../reference/sizes.md).

## Lifecycle

Snapshots declare rootfs and memory preservation with the source kept; the declared path is `/root`. Restore with `snapshotId`; see [snapshot semantics and cleanup](../reference/compute.md#snapshot-capabilities).

## Installation & Setup

```bash
npm install @computesdk/beam
```

Add your Beam credentials to a `.env` file:

```bash
BEAM_TOKEN=your_beam_token
BEAM_WORKSPACE_ID=your_beam_workspace_id
```

## Usage

```typescript
import { beam } from '@computesdk/beam';

const compute = beam({
  token: process.env.BEAM_TOKEN,
  workspaceId: process.env.BEAM_WORKSPACE_ID,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Beam!"');
console.log(result.stdout); // "Hello from Beam!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface BeamConfig {
  /** Beam API token - if not provided, will use BEAM_TOKEN env var */
  token?: string;
  /** Beam workspace ID - if not provided, will use BEAM_WORKSPACE_ID env var */
  workspaceId?: string;
  /** Gateway URL for custom/staging environments */
  gatewayUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}
```
