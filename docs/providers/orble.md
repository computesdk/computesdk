---
description: >-
  Orble provider for ComputeSDK - Linux VMs with root and Docker
  inside, memory snapshots, pause/resume, and URLs for any port.
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

# Orble

[Orble](https://orble.tech) provider for ComputeSDK - Linux VMs ("boxes") with root and Docker inside. Idle boxes suspend with their memory and wake on the next command.

## Installation & Setup

```bash
npm install @computesdk/orble
```

Create an API key at [orble.tech/settings](https://orble.tech/settings?tab=api) and add it to a `.env` file:

```bash
ORBLE_API_KEY=orble_your_api_key
```

## Usage

```typescript
import { orble } from '@computesdk/orble';

const compute = orble({
  apiKey: process.env.ORBLE_API_KEY,
});

// Create a sandbox with 8 vCPU / 16 GiB
const sandbox = await compute.instances.create({ sizeClass: 'xl' });

// Run a command
const result = await sandbox.runCommand('echo "Hello from Orble!"');
console.log(result.stdout);

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface OrbleConfig {
  /** Orble API key - if not provided, will use ORBLE_API_KEY env var */
  apiKey?: string;
  /** API base URL - if not provided, will use ORBLE_API_URL env var, then https://orble.tech */
  baseUrl?: string;
  /** Who commands and file operations run as: 'root' (the default) or 'agent' - if not provided, will use ORBLE_USER */
  user?: 'root' | 'agent';
}
```

### Create Options

- `sizeClass`: see [Sizes](#sizes).
- `size`: Orble's own size, `'micro'`, `'s'`, `'m'` or `'l'`, instead of `sizeClass`.
- `templateId` or `snapshotId`: an Orble snapshot to start the box from, one of yours or Orble's (`orble snapshots` lists them). The box is at least the snapshot's size.
- `name`: the box's name.

## Snapshots, pause and templates

`snapshot.create(instanceId, { name })` saves the box's disk, memory and running programs; `name` is optional (Orble picks `<box>-1`). A running box pauses briefly and keeps running. `instances.create({ snapshotId })` starts a box from it, as many as you like: at the snapshot's size the box resumes with its memory and programs, and at a larger size it boots from the snapshot's disk. `snapshot.capabilities` is `{ scope: 'rootfs', memory: true, destroysSource: false, source: 'kept', fork: true }`.

`pause()` suspends the box with its memory; `resume()`, or any command, wakes it where it was (`provider.instances.pause.memory: true`). `getInfo()` reports a suspended box as `stopped`.

Templates are snapshots: `template.list()` returns your snapshots and Orble's (marked `metadata.gallery`), and `template.delete()` deletes one of yours. Orble doesn't build templates from an image, so `template.create()` throws; set up a box and use `snapshot.create()`.

## Sizes

| `sizeClass` | Orble size | vCPU / RAM |
|---|---|---|
| `xs` | `micro` | 1 / 2 GiB |
| `sm` | `micro` | 1 / 2 GiB |
| `md` | `s` | 2 / 4 GiB |
| `lg` | `m` | 4 / 8 GiB |
| `xl` | `l` | 8 / 16 GiB |

Every size has a 64 GiB disk. `2xl` and `3xl` are `unsupported`, and `sizeClass` with `size` is a conflict. See [Sandbox sizes](../reference/sizes.md).

## Notes

- Commands and file operations run as `root`, from `/root`, by default. With `user: 'agent'` (or `ORBLE_USER=agent`) they run as the box's own user, from `/home/agent`, where SSH logins and agents work. A command's own `user` option, `'root'` or `'agent'`, overrides it.
- A command may run for up to 10 minutes, and a longer `timeout` is capped there. Each output stream comes back as its last 64 KiB.
- `readFile` and `writeFile` stream the whole file in one request, up to 4 GiB.
- `getUrl({ port })` shares the port and returns its URL. The port is private by default: only people signed in to the box's Orble account can open it. `getUrl({ port, public: true })` makes it public, for anyone with the address; public ports need an account that has added credit.
