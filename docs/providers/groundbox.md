---
description: >-
  Groundbox provider for ComputeSDK - Firecracker VM sandboxes with streaming
  commands, files, preview URLs, pause and resume, snapshots, templates and volumes.
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

# Groundbox

[Groundbox](https://groundbox.dev) provider for ComputeSDK - Firecracker VM sandboxes with streaming commands, files, preview URLs, pause and resume, snapshots, templates and volumes.

## Installation & Setup

```bash
npm install @computesdk/groundbox
```

Create an API key in the [Groundbox dashboard](https://app.groundbox.dev/keys), with the `sandboxes:read` and `sandboxes:write` scopes, then add it to a `.env` file:

```bash
GROUNDBOX_API_KEY=gbx_your_api_key
```

Sandboxes need the paid plan ($20 a month) or the free trial a new account starts with. The free plan has no sandboxes: on it, `create` fails with `paid_plan_required`. The trial has $1 of usage and runs up to two sandboxes at once, each of at most 2 vCPUs and 4 GB for an hour; previews, kept snapshots, volumes, templates and `on_timeout` other than `delete` need the paid plan.

Node 20 or later is required. Live output and `startProcess` use a WebSocket: Node 22 has one built in; on Node 20, pass one in the config (`WebSocket`), for example the one from the `ws` package.

## Usage

```typescript
import { groundbox } from '@computesdk/groundbox';

const compute = groundbox({ apiKey: process.env.GROUNDBOX_API_KEY });

const sandbox = await compute.instances.create({ sizeClass: 'md', timeout: 30 * 60_000 });

const result = await sandbox.runCommand('echo "Hello from Groundbox!"');
console.log(result.stdout);

// Output as it is printed. A command gets 60 seconds unless it is given a timeout.
await sandbox.runCommand('mkdir -p app && cd app && npm init -y && npm install left-pad', {
  timeout: 5 * 60_000,
  onStdout: (text) => process.stdout.write(text),
});

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hi');

// An HTTPS URL for a port
const url = await sandbox.getUrl({ port: 3000 });

await sandbox.destroy();
```

### Configuration Options

```typescript
interface GroundboxConfig {
  apiKey?: string;                    // falls back to GROUNDBOX_API_KEY
  baseUrl?: string;                   // falls back to GROUNDBOX_API_URL, then https://api.groundbox.dev/v1
  previews?: 'private' | 'public';    // what getUrl makes; default 'private'
  fetch?: typeof fetch;               // custom HTTP transport
  WebSocket?: typeof WebSocket;       // for live output and startProcess; default: the runtime's own
}
```

### Create options

| Option | Notes |
|---|---|
| `sizeClass` | `xs` (1 vCPU, 1 GB), `sm` (1, 2 GB), `md` (2, 4 GB), `lg` (4, 8 GB) or `xl` (8, 16 GB), asked for exactly. `2xl` is `unknown` (not checked through this adapter): pass `cpus: 16, memory_gb: 32`. `3xl` is `unsupported` |
| `cpus`, `memory_gb`, `disk_gb` | 1 to 16 vCPUs, whole GB of memory up to 4 GB per vCPU, disk 1 to 100 GB. Default 2 vCPUs, 4 GB, 20 GB. A team runs at most two sandboxes of more than 8 vCPUs at once |
| `timeout` | Lifetime in milliseconds, rounded up to whole minutes. Default one hour, 30 days at most, renewable with `extendLifetime` |
| `on_timeout` | `delete` (the default), `stop` (keep the disk) or `pause` (keep memory too). Paid plan |
| `envs`, `metadata` | Environment variables for every command; labels (non-string values are stored as JSON) |
| `templateId`, `image`, `snapshotId` | What the sandbox starts from, one at most: a template, a Docker image such as `node:22-slim`, or a kept snapshot |
| `volumes` | `{ volume, mountPath, readOnly? }` mounts, four at most |
| `allow_hosts`, `deny_hosts` | Egress allow and deny lists: host names, wildcards, IPv4 addresses and networks |
| `secrets`, `env_from_secrets` | Team secrets given to every command as variables. The key needs `secrets:use` |
| `flex` | Half price for work that can wait: the sandbox starts when there is spare room |
| `signal` | Cancels creation; an abort while `create` waits for the sandbox deletes it |

`create` returns once the sandbox runs, except for a `flex` sandbox. `getInfo()` reports the size the VM booted at under `metadata.groundbox.booted`.

## Features

- **Commands**: `runCommand` runs `sh -c`, 60 seconds unless given a `timeout` (one hour at most). With `onStdout`/`onStderr` the output streams as it is printed. `background: true` starts the command and returns at once.
- **Processes**: `startProcess` is native and resumable. `write` sends text or bytes to stdin; `kill(signal)` sends `SIGKILL` (the default), `SIGTERM`, `SIGINT`, `SIGHUP`, `SIGQUIT`, `SIGUSR1` or `SIGUSR2` to the process and everything it started.
- **Files**: `readFile`, `writeFile` (makes parent folders), `readdir`, `mkdir`, `exists` and `remove` (recursive), through Groundbox's files API.
- **Preview URLs**: `getUrl({ port })` returns a private preview's share link (good for 24 hours), or with `previews: 'public'` a URL anyone can open. `protocol: 'wss'` gives the WebSocket address.
- **Pause and resume**: memory and disk are kept, and processes run again after `resume`. A sandbox with volumes cannot be paused.
- **Snapshots**: `snapshot.create` keeps a running sandbox's memory, processes and disk; the source keeps running. It can return while the snapshot is `creating`: call `snapshot.waitUntilReady` before starting from it with `snapshotId`. A snapshot no sandbox started from for 30 days is deleted.
- **Templates and volumes**: `template.create({ name, image, pip, ... })`, and `volume.create({ name, sizeBytes })` in whole GB, attached at create time.

The native `@groundbox/sdk` client is `sandbox.getInstance().client`, for what ComputeSDK has no method for: forks, save points and rewind, desktops, and stopping a sandbox with its disk kept.

## Limitations

- `runCommand` with `background: true` has no handle: use `startProcess` to read, wait for or stop a process.
- Commands are shell lines (`sh -c`); Groundbox's `args` (no shell) and terminal (`tty`) modes are reachable through the native client only.
- Sandboxes run Groundbox's image (Ubuntu 24.04, Linux amd64) unless a template or an image says otherwise.
