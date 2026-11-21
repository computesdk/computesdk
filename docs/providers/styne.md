---
description: >-
  Styne provider for ComputeSDK - microVM sandboxes with streaming commands,
  file transfer, memory snapshots, templates and volumes.
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

# Styne

[Styne](https://styne.ai) provider for ComputeSDK - microVM sandboxes with streaming command output, file transfer, snapshots that keep memory and running processes, saved templates and persistent volumes.

## Installation & Setup

```bash
npm install @computesdk/styne
```

Sign up at [styne.ai](https://styne.ai) and create a key on the **API keys** page of the dashboard ([authentication](https://docs.styne.ai/authentication)). Then add it to a `.env` file:

```bash
STYNE_API_KEY=your_styne_api_key
```

## Usage

```typescript
import { compute } from 'computesdk';
import { styne } from '@computesdk/styne';

compute.setConfig({
  provider: styne({ apiKey: process.env.STYNE_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from Styne!"');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { styne } from '@computesdk/styne';

const sdk = styne({ apiKey: process.env.STYNE_API_KEY });

const sandbox = await sdk.instances.create({ templateId: 'default', timeout: 30 * 60 * 1000 });

// Output streams in as the command runs
await sandbox.runCommand('for i in 1 2 3; do echo $i; sleep 1; done', {
  onStdout: (chunk) => process.stdout.write(chunk),
});

await sandbox.filesystem.writeFile('/tmp/hello.sh', 'echo $((6 * 7))');
console.log((await sandbox.runCommand('sh /tmp/hello.sh')).stdout); // "42\n"

// Snapshot memory, processes and disk; the source keeps running.
const snapshot = await sdk.snapshot.create(sandbox.instanceId, { name: 'checkpoint' });
const copy = await sdk.instances.create({ snapshotId: snapshot.id });

await copy.destroy();
await sandbox.destroy();
await sdk.snapshot.delete(snapshot.id);
```

## Configuration

```typescript
interface StyneConfig {
  /** Styne API key - if not provided, will use STYNE_API_KEY env var */
  apiKey?: string;
  /** API base URL - if not provided, will use STYNE_API_URL env var, then https://api.styne.ai; must be https:// except for localhost */
  apiUrl?: string;
  /** Default sandbox lifetime in milliseconds when create() gets no timeout */
  timeout?: number;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `templateId` | `templateID` | A built-in template from `template.list()` (for example `default`, or `small`/`large`/`xlarge`), or a template saved with `template.create()`. |
| `size` | `size` | `small` (2 vCPU / 4 GiB), `default` (4 / 8 GiB, what a create without a template or size gets), `large` (8 / 16 GiB) or `xlarge` (16 / 32 GiB). Not with `snapshotId` or `image`, which keep their own size; with `templateId`, only the template of that name. |
| `snapshotId` | `snapshot` | Start from a saved snapshot. Takes precedence over `image` and `templateId`. |
| `image` | `image` | Start from a container image the account has prepared. Takes precedence over `templateId`. |
| `timeout` (ms) | `timeout` | Lifetime, rounded up to whole seconds and capped at 24 hours. The API default is 5 minutes. |
| `envs` | `envVars` | Environment variables for every command in the sandbox. |
| `metadata` | `metadata` | String keys and values. |
| `name` | `metadata.name` | Stored as metadata. |
| `volumes` | `volumeMounts` | `{ volume, mountPath, readOnly? }`; `volume` is a handle from `volume.create()` or a volume name or id. |

## Standard sizes

`sizeClass` requests a standard CPU/RAM size ([Sandbox sizes](../reference/sizes.md)). Styne sells four sizes ([limits](https://docs.styne.ai/limits#sandbox-sizes)), so each supported size sends the Styne `size` it equals:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
```

| `sizeClass` | `size` | vCPU / Memory (MiB) | Disk (MiB) |
| --- | --- | --- | ---: |
| `md` | `small` | 2 / 4096 | 52224 |
| `lg` | `default` | 4 / 8192 | 52224 |
| `xl` | `large` | 8 / 16384 | 113664 |
| `2xl` | `xlarge` | 16 / 32768 | 257024 |

`xs` and `sm` (the smallest Styne size has 2 vCPU) and `3xl` (the largest has 16 vCPU) are `unsupported` and never boot. A sandbox is a clone of what it starts from and keeps its size, so `sizeClass` with `snapshotId`, `image` or `templateId` is `unsupported`. Combining `sizeClass` with the native `size` is a `conflict`. Sizes above the account's plan fail at create with `402 plan_required` instead of booting smaller.

The universal resource fields `vcpus` (or `cpus`), `memoryMiB` (or `memMiB`, `memoryMb`) and `diskMiB` (or `diskMb`), read in vCPUs and MiB, ask for the size in the table with exactly that many vCPUs and at least that memory and disk; with no vCPU count, the smallest size that has the memory and disk:

```typescript
const sandbox = await compute.instances.create({ vcpus: 8, memoryMiB: 16384 }); // Styne `large`
```

A request no Styne size gives exactly (1, 3 or 32 vCPU; 2 vCPU with 8 GiB; more than 16 vCPU / 32 GiB / 251 GiB disk) rejects with `InstanceSizeError` (`unsupported`, or `invalid` for an unreadable value such as `memoryMiB: 8`) before any sandbox starts. Fields that disagree, or these fields next to `sizeClass` or `size`, are a `conflict`; with `snapshotId`, `image` or `templateId` they are `unsupported`. Other providers' own fields (`cpu`, `memory`, `resources`, `vmTier`, ...) are left to them. Only a `sizeClass` create records `sandbox.sizing`.

## Features

- **Command execution** with live `stdout`/`stderr` streaming, `cwd`, `env`, `timeout` and background commands
- **Filesystem**: `readFile`, `writeFile`, `readdir` and `remove` use the Styne files API; `mkdir` and `exists` run as shell commands
- **Snapshots**: `snapshot.create()` saves memory, processes and the root filesystem of a running sandbox without stopping it. Restore with `instances.create({ snapshotId })`, as many times as needed.
- **Templates**: `template.list()` returns the built-in templates and the account's saved ones. `template.create({ name, image?, templateId? })` starts a sandbox, saves it under `name` and destroys it.
- **Volumes**: `volume.create()`, `get()`, `list()` and `delete()`; mount them at create time with `volumes`
- **Pause and resume**: `sandbox.pause()` keeps memory and processes; `sandbox.resume()` continues under the same id and restarts the lifetime the sandbox was created with
- **Lifetime**: `sandbox.extendLifetime(ms)` keeps the sandbox alive for at least `ms` more (up to 24 hours) and never shortens its life
- **Port URLs**: `getUrl({ port })` returns `https://<port>-<sandboxId>.<domain>`
- **List**: `instances.list()` returns all of the account's sandboxes, page by page

## Limitations

- `runCommand`'s `timeout` is enforced by the API; a command stopped at its timeout reports exit code 124.
- Paused sandboxes are reported by `getInfo()` as `stopped`.
- A sandbox with a mounted volume cannot be paused or snapshotted (`409`, "the sandbox has a volume mounted").
- Built-in templates cannot be deleted; `template.delete()` only removes templates saved by the account.
- `image` needs an image the account has prepared (see https://docs.styne.ai/images); a create of an image that is still being prepared is repeated for up to a minute.
- `readdir` entries have no modification time, and symbolic links are listed as files.
- If `template.create()` saves the template but cannot destroy its source sandbox, it still returns the template; the sandbox ends when its lifetime runs out.
- Requests are sent again only when that is safe: when they never reached the API, when repeating them is harmless (`GET`, `PUT`, `DELETE`), or when the API asks for a retry (`429`, `503`, after its `Retry-After`). Every `create` carries an `Idempotency-Key`, so a repeated create gets the sandbox the first attempt started, never a second one.
- Calls about a sandbox go to the API host of its region (`<region>.api.styne.ai`, from the `domain` the API reports); creates and account-wide calls use `api.styne.ai`, and a custom `apiUrl` is used as given.
- A request that gets no answer for 2 minutes fails with `ETIMEDOUT`. Commands are not cut off this way: a command with a `timeout` gets 30 seconds beyond it, and a command without one has no limit.
