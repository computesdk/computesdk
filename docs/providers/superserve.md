---
description: >-
  Superserve provides sandbox infrastructure to run code in isolated cloud
  environments powered by Firecracker MicroVMs.
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

# Superserve

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/superserve/" %}

Superserve provides sandbox infrastructure to run code in isolated cloud environments powered by Firecracker MicroVMs.

## Standard sizes

`sizeClass` requests a standard CPU/RAM size. Superserve fixes vCPU, memory and disk when a template is built (sandboxes cannot override them), so each standard size boots its own template:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
```

| `sizeClass` | Template | vCPU / memory / disk |
| --- | --- | --- |
| `xs` | `csdk-node22-1cpu-1gb` | 1 / 1 GiB / from the build |
| `sm` | `csdk-node22-1cpu-2gb` | 1 / 2 GiB / from the build |
| `md` | `superserve/base` (built in) | 2 / 4 GiB / 8 GiB |
| `lg` | `csdk-node22-4cpu-8gb` | 4 / 8 GiB / from the build |
| `xl` | `csdk-node22-8cpu-16gb` | 8 / 16 GiB / from the build |
| `2xl` | `csdk-node22-16cpu-32gb` | 16 / 32 GiB / from the build |

`3xl` (32 vCPU / 64 GiB) is `unsupported` by default. Each team template must exist on the team; [Provider Setup](../../ADD-PROVIDER.md#provider-setup) builds the default team templates in the table, and a create that hits a missing one fails with setup guidance. Plan limits apply at create time (Free allows 2 vCPU / 4 GiB, Developer 4 vCPU / 16 GiB, Pro 16 vCPU / 64 GiB).

Override a template name per size with the `sizeTemplates` config. If your team already has a template that meets the `3xl` profile, you can map it with `superserve({ sizeTemplates: { '3xl': 'acme/node-32cpu-64gb' } })`. The resolver does not check the custom template's resources or your plan. `templateId`, `snapshotId`, `sandboxId`, `fromTemplate` or `fromSnapshot` with `sizeClass` is `unsupported` (the template or snapshot fixes the size); native `vcpu`, `vcpuCount`, `memoryMib`, `memoryMaxMib` or `diskMib` with `sizeClass` is a `conflict`. See [Sandbox sizes](../reference/sizes.md).

## Lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshots capture rootfs and memory and keep the source. Create-time `timeout` configures auto-pause, not a command deadline or automatic deletion.

## Installation & Setup

```bash
npm install @computesdk/superserve
```

Add your Superserve credentials to a `.env` file:

```bash
SUPERSERVE_API_KEY=your_api_key
```

## Usage

```typescript
import { superserve } from '@computesdk/superserve';

const compute = superserve({
  apiKey: process.env.SUPERSERVE_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Superserve!"');
console.log(result.stdout); // "Hello from Superserve!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface SuperserveConfig {
  /** Superserve API key. Falls back to `SUPERSERVE_API_KEY` env var. */
  apiKey?: string;
  /** API base URL. Falls back to `SUPERSERVE_BASE_URL` env var, then the `@superserve/sdk` default. */
  baseUrl?: string;
  /** Default auto-pause timeout in milliseconds. */
  timeout?: number;
  /** Template to boot per standard `sizeClass`; defaults to SUPERSERVE_SIZE_TEMPLATES. */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                         |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Boots a Firecracker microVM; accepts `templateId` to boot from a template or `snapshotId` to boot a snapshot. |
| `getById`    | ✅         | Connects to a sandbox by id (issues `POST /activate`, auto-resumes paused).                                   |
| `list`       | ✅         | Read-only — returns `InstanceInfo` stubs without opening a session.                                            |
| `destroy`    | ✅         | Kills the sandbox by id.                                                                                      |
| `runCommand` | ✅         | Supports `cwd`, `env`, `timeout`, `background`, and live output via `onStdout`/`onStderr`.                    |
| `getInfo`    | ✅         | `paused` and `deleted` map to `stopped`, `failed` to `error`, otherwise `running`.                            |
| `filesystem` | ✅         | `readFile`/`writeFile` use the data plane; `mkdir`/`readdir`/`exists`/`remove` are shell fallbacks.           |
| `getUrl`     | ✅         | Publishes the port (1024–65535) and returns its preview URL. Published ports are public by default.           |
| `snapshot`   | ✅         | `create`, `list` (per sandbox — pass `instanceId`), and `delete`. Snapshots capture memory and disk.           |

### Notes

* `template.create` builds a template from an image (`from`) with optional `vcpu`, `memoryMib`, `diskMib` and `steps`, and waits until it is ready.
* `snapshot.create` connects to the sandbox first, which resumes it if it is paused.
* Authentication failures (HTTP 401, missing key, SDK `AuthenticationError`) are normalized into a single user-facing message.
