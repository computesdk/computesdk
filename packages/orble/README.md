# @computesdk/orble

Orble provider for ComputeSDK: Linux VMs ("boxes") with root and Docker inside. Idle boxes suspend with
their memory and wake on the next command.

## Installation

```bash
npm install @computesdk/orble
```

## Setup

1. Create an API key at [orble.tech/settings](https://orble.tech/settings?tab=api)
2. Set the environment variable:

```bash
export ORBLE_API_KEY=orble_your_api_key
```

## Quick Start

```typescript
import { orble } from '@computesdk/orble';

const compute = orble({});
const box = await compute.instances.create({ sizeClass: 'xl' }); // 8 vCPU / 16 GiB

const result = await box.runCommand('uname -a');
console.log(result.stdout);

await compute.instances.destroy(box.instanceId);
```

## Sizes

| sizeClass | Orble size | vCPU / RAM |
|---|---|---|
| `xs` | `micro` | 1 / 2 GiB |
| `sm` | `micro` | 1 / 2 GiB |
| `md` | `s` | 2 / 4 GiB |
| `lg` | `m` | 4 / 8 GiB |
| `xl` | `l` | 8 / 16 GiB |

Every size has a 64 GiB disk. Pass Orble's own `size` (`'micro'`, `'s'`, `'m'` or `'l'`) instead of `sizeClass` if you
prefer.

## Options

- `templateId` or `snapshotId`: an Orble snapshot to start the box from, one of yours or Orble's
  (`orble snapshots` lists them). The box is at least the snapshot's size.
- `name`: the box's name.
- `keepAwake`: `true` turns off idle suspension, for a box that serves apps or runs work on its own.

Commands and file operations run as `root`, from `/root`, by default. Set `user: 'agent'` (or `ORBLE_USER=agent`) to
run them as the box's own user, from `/home/agent`, where SSH logins and agents work; a command's own `user` option,
`'root'` or `'agent'`, overrides it. A command may run for up to 10 minutes; each output stream comes back as its last
64 KiB. `readFile` and `writeFile` stream the whole file in one request, up to 4 GiB.

## Snapshots and pause

```typescript
const snap = await compute.snapshot.create(box.instanceId); // disk, memory and running programs
const copy = await compute.instances.create({ snapshotId: snap.id });

await box.pause();  // suspends with its memory
await box.resume(); // any command also wakes it
```

A running box pauses briefly for a snapshot and keeps running. A box started from a snapshot at the snapshot's size
resumes with its memory and programs; at a larger size it boots from the snapshot's disk. `template.list()` returns
your snapshots and Orble's; there are no template builds, so `template.create()` throws.

## Configuration

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `ORBLE_API_KEY` | |
| `baseUrl` | `ORBLE_API_URL` | `https://orble.tech` |
| `user` | `ORBLE_USER` | `root` (or `agent`) |
