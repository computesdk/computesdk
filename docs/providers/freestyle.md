---
description: >-
  Set up the Freestyle provider for ComputeSDK, configure your API key, and
  create sandboxes to run commands.
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

# Freestyle

[Freestyle](https://www.freestyle.sh) provider for ComputeSDK: full Linux virtual machines designed for long-running, complex agent tasks, with instant startup, persistence, and cheap snapshotting.

## Standard sizes

| `sizeClass` | Freestyle shape | How |
| --- | --- | --- |
| `xs`, `sm` | — | `unsupported`: resize is grow-only and the smallest Ubuntu snapshot is 2 vCPU / 4 GiB. |
| `md` | 2 vCPU / 4096 MiB / 16 GB disk | Boots the public `freestyle/ubuntu-sm` snapshot as-is. |
| `lg` | 4 vCPU / 8192 MiB / 32 GB disk | The default runtime snapshot, no resize. |
| `xl` | 8 vCPU / 16384 MiB / 32 GB disk | Runtime snapshot grown with `vm.resize({ cpu, memory })`. |
| `2xl` | 16 vCPU / 32768 MiB / 32 GB disk | Same; needs the Pro plan (32 vCPU / 64 GiB per-VM maximum). |
| `3xl` | 32 vCPU / 65536 MiB / 32 GB disk | Same; Pro's per-VM maximum. |

Sizes are exact; the adapter waits for the guest to see the grown vCPUs and memory, and deletes the VM if the snapshot boots larger than requested or the resize fails. Disk is not resized. `sizeClass` cannot be combined with `cpu`/`memory`, and is `unsupported` with `sandboxId`, `snapshotId`, `templateId`, `config.snapshotId` or `FREESTYLE_SNAPSHOT_ID`, because the snapshot sets a Freestyle VM's base size. Plan per-VM maximums are enforced by Freestyle at create time. See [Sandbox sizes](../reference/sizes.md) and Freestyle's [pricing and limits](https://www.freestyle.sh/docs/vms/pricing-and-limits) and [base snapshots](https://www.freestyle.sh/docs/vms/base-snapshots).

## Lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshots declare rootfs and memory preservation with the source kept; restore with `snapshotId`.

## Installation & Setup

```bash
npm install @computesdk/freestyle
```

Add your Freestyle credentials to a `.env` file:

```bash
FREESTYLE_API_KEY=your_freestyle_api_key
```

Freestyle base images ship no language runtime, so the **first** sandbox on an account bakes a Node + Python snapshot once (~20 s) and every sandbox after boots from it in ~200–300 ms. Set `FREESTYLE_SNAPSHOT_ID` (or the `snapshotId` option) to your own snapshot to skip baking.

## Usage

```typescript
import { freestyle } from '@computesdk/freestyle';

const compute = freestyle({
  apiKey: process.env.FREESTYLE_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Freestyle!"');
console.log(result.stdout); // "Hello from Freestyle!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface FreestyleConfig {
  /** Freestyle API key. Falls back to FREESTYLE_API_KEY. */
  apiKey?: string;
  /** Snapshot every sandbox boots from. Falls back to FREESTYLE_SNAPSHOT_ID; auto-baked when unset. */
  snapshotId?: string;
  /** API base URL. Falls back to FREESTYLE_API_URL, then the SDK default. */
  baseUrl?: string;
  /** Idle seconds before Freestyle stops the VM. Default: 300 */
  idleTimeoutSeconds?: number;
  /** Default wall-clock limit for a single command, ms. Default: 300000 */
  timeout?: number;
  /** Keep the VM after it stops instead of deleting it. Default: ephemeral */
  persistent?: boolean;
  /** Outbound firewall. Defaults to allow-all outbound; pass { rules: [] } to seal. */
  firewall?: { rules: unknown[] };
}
```

## Capabilities

Freestyle VMs are full Linux guests, so the whole filesystem surface is native rather than shelled through `runCommand`:

```typescript
await sandbox.filesystem.writeFile('/tmp/app.js', 'console.log("hi")');
await sandbox.filesystem.readFile('/tmp/app.js');
await sandbox.filesystem.readdir('/tmp');
await sandbox.filesystem.mkdir('/tmp/sub');
await sandbox.filesystem.exists('/tmp/app.js');
await sandbox.filesystem.remove('/tmp/app.js');
```

Snapshots (`compute.snapshot.create` / `list` / `delete`) and reconnect-by-id (`compute.instances.getById`) are supported. `getUrl` is not: Freestyle exposes VMs through mapped domains ([`freestyle.domains`](https://docs.freestyle.sh)), not a stock per-port URL.
