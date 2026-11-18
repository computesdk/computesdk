---
description: >-
  Use Archil with ComputeSDK to manage persistent VMs or opt into disk exec,
  with native processes, pause/resume, snapshots, and size tiers.
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

# Archil

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/archil/" %}

Archil defaults to persistent VMs: commands, files, and processes share a sandbox.
Disk exec is an explicit opt-in for commands against an existing disk.

## Installation & Setup

```bash
npm install @computesdk/archil
```

Provide `apiKey` and `region` in config or through `ARCHIL_API_KEY` and
`ARCHIL_REGION`. A custom `baseUrl` can replace region-based endpoint selection.

## Persistent VMs (default)

```typescript
import { archil } from '@computesdk/archil';

const provider = archil();
const sandbox = await provider.instances.create({
  sizeClass: 'md',
  image: 'node:24-bookworm',
});
await sandbox.runCommand('echo hello > /root/note');
console.log(await sandbox.filesystem.readFile('/root/note'));
await sandbox.pause!();
await sandbox.resume!();
await sandbox.destroy();
```

`create` provisions a VM; `getById`, `list`, and `destroy` operate on VMs.
Commands, streaming, and `startProcess` use Archil's native process API.
`getUrl` exposes a persistent VM's service port.

Create accepts `name`, `baseImage` (or `image`), `env` (or `envs`), native
`vcpus`/`memoryMiB`, and `maxTtlSeconds`. Unified `timeout` is milliseconds
and maps to the session lifetime budget in seconds.

### Pause, snapshots, and forks

Create with `ephemeral: false` when explicitly requesting lifecycle support.
Pause/resume preserve memory and running processes. Snapshots preserve the
whole rootfs (including `/tmp`) and memory, and leave the source running.

A snapshot is a separate paused VM fork, not a separate storage object.
`provider.snapshot.create` makes that fork; `list` finds snapshot forks;
`delete` removes one. `instances.create({ snapshotId })` forks it again into
a running VM. Delete restored children before snapshots, and snapshots before
their source VM.

## Standard sizes

New persistent VMs support `sizeClass` through exact `vcpus` / `memoryMiB`
(sent as Archil's `vcpu_count` / `mem_size_mib`). Archil allows 1–32 vCPU and
256–65536 MiB per sandbox; the root filesystem is an Archil disk with no size
field, so no disk is set.

| `sizeClass` | Status | Archil shape |
| --- | --- | --- |
| `xs` | supported | 1 vCPU / 1024 MiB |
| `sm` | supported | 1 vCPU / 2048 MiB |
| `md` | supported | 2 vCPU / 4096 MiB |
| `lg` | supported | 4 vCPU / 8192 MiB |
| `xl` | supported | 8 vCPU / 16384 MiB |
| `2xl` | supported | 16 vCPU / 32768 MiB |
| `3xl` | unsupported | Needs 128 GiB; Archil caps memory at 64 GiB |

Exec mode (`execution: 'exec'` or `ephemeral: true`) is `unavailable`.
Attaching or restoring (`sandboxId`, `instanceId`, `snapshotId`) is
`unsupported`: Archil fork options take no CPU/RAM fields. Native `vcpuCount` /
`memSizeMiB` (or `vcpu_count` / `mem_size_mib`, top level or under `sandbox`)
conflict with `sizeClass`. See [Sandbox sizes](../reference/sizes.md).

## Disk exec (opt-in)

```typescript
const provider = archil({ execution: 'exec' });
const sandbox = await provider.instances.create({
  diskId: process.env.ARCHIL_DISK_ID,
});
await sandbox.runCommand('echo hello > /mnt/archil/note');
await sandbox.destroy(); // Does not delete the disk.
```

Use `execution: 'exec'` (or `ARCHIL_EXECUTION=exec`) with `diskId`;
`ephemeral: true` also selects exec for a create. Passing only `diskId` in
persistent mode throws rather than silently changing modes.

Each exec runs in a fresh container. Only disk contents persist; there is no
service port, VM pause/resume, or standard VM sizing. Filesystem helpers map
normal paths under `/mnt/archil`; raw command strings must use that mount path
themselves. Streaming falls back to output at completion when exec state is
not shared, and `startProcess` cannot provide a persistent shell-tier process.
Exec responses are subject to the control plane's output limit.

## Configuration

```typescript
interface ArchilConfig {
  apiKey?: string;
  region?: string;
  baseUrl?: string;
  execution?: 'exec' | 'persistent';
}
```
