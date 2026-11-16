# @computesdk/boxd

[boxd](https://boxd.sh) provider for ComputeSDK. Each sandbox is an isolated boxd machine — a KVM microVM with its own kernel, network stack, and disk — driven through the official [`@boxd-sh/sdk`](https://www.npmjs.com/package/@boxd-sh/sdk).

## Installation

```bash
npm install @computesdk/boxd
```

Requires Node.js 20 or newer.

## Setup

Create an API key in the [boxd console](https://app.boxd.sh) or with the CLI (`boxd auth keys create <name>`) and export it:

```bash
export BOXD_API_KEY=bxd_your_api_key
```

## Usage

```typescript
import { boxd } from '@computesdk/boxd';

const compute = boxd({ apiKey: process.env.BOXD_API_KEY });

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from boxd!"');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello World');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

// Serve something on port 3000, then get its public HTTPS URL
await sandbox.runCommand('python3 -m http.server 3000', { background: true });
console.log(await sandbox.getUrl({ port: 3000 }));

// Save a snapshot and start a new sandbox from it
const snapshot = await compute.snapshot.create(sandbox.instanceId);
await compute.snapshot.waitUntilReady(snapshot.id);
const copy = await compute.instances.create({ snapshotId: snapshot.id });

await copy.destroy();
await sandbox.destroy();
await compute.snapshot.delete(snapshot.id);
```

## Configuration

| Option | Environment variable | Default | Description |
|---|---|---|---|
| `apiKey` | `BOXD_API_KEY` | required | boxd API key (`bxd_...`) |
| `region` | `BOXD_REGION` | SDK default (`fra`) | Region for new machines (`fra` or `nyc`) |

## Behavior

- Every sandbox is created with `isolated: true`, so it cannot reach your other boxd machines or integrations.
- `create` waits until the machine is ready before returning.
- Create options:
  - `name` sets the machine name (boxd generates one if omitted).
  - `image` picks the boot image; `envs` sets machine-level environment variables; string `metadata` values become machine labels.
  - `vcpus` / `memoryMiB` pick a boxd size (1/4, 2/8, 4/16 or 8/32 vCPU/GiB). Standard `sizeClass` values are reported as unsupported because none matches a boxd size exactly.
  - `timeout` (ms) maps to boxd's `deleteAfter`, so the machine is deleted automatically after that long.
  - `egress: ['api.example.com', '*.example.com']` sets the machine's egress allowlist (`['none']` blocks everything). The egress-router object form is not supported.
  - `volumes: [{ volume, mountPath, readOnly? }]` attaches boxd disks at creation (by id, name or volume handle).
  - `snapshotId` (or `templateId`) restores the machine from a boxd snapshot by name or ID. Disks can't be attached to a restored machine.
- `runCommand` with `onStdout`/`onStderr` streams output live over boxd's `streamExec`; a `timeout` closes the stream, which kills the remote process group.
- `startProcess` runs interactive processes (stdin, live output, `kill`) over `streamExec`.
- `pause()` suspends the machine to RAM and `resume()` thaws it, with running processes intact.
- `extendLifetime(ms)` pushes back the delete time of a machine created with `timeout` (machines without one never expire).
- `attachVolume` / `detachVolume` move boxd disks. A disk lives on one host, so attaching to an existing machine only works if they share a host; use `volumes` on create to pair them reliably.
- `compute.snapshot.create(instanceId, { name })` saves a boxd snapshot (disk and memory) of a running machine and returns its name as `id`. It returns while the snapshot is still saving, so call `compute.snapshot.waitUntilReady(id)` before restoring from it. Saving again under the same name replaces it with a new version.
- `compute.snapshot.list()` lists snapshots in the client's region; boxd doesn't record a snapshot's source machine, so the `instanceId` filter is ignored.
- `compute.volume.create({ name, sizeBytes })` creates a boxd disk (10 GB by default); `get`, `list` and `delete` accept a disk id or name.
- `getUrl({ port })` creates a boxd HTTPS proxy route named `p<port>` and returns its URL. Calling it again for the same port reuses the route.

## Supported features

| Feature | Supported |
|---|---|
| Create / get / list / destroy | Yes |
| Run commands (env, cwd, background, timeout) | Yes |
| Streaming output (`onStdout` / `onStderr`) | Yes (native `streamExec`) |
| Interactive processes (`startProcess`) | Yes (native `streamExec`) |
| Filesystem | Yes (native boxd filesystem API) |
| Port URLs (`getUrl`) | Yes (boxd HTTPS proxies) |
| Snapshots | Yes (disk + memory; the source keeps running) |
| Pause / resume | Yes (suspend to RAM; memory kept) |
| Lifetime extension | Yes (for machines created with `timeout`) |
| Volumes | Yes (boxd disks) |
| Egress allowlist | Yes (`egress: string[]`) |
| Standard `sizeClass` | No (boxd sizes don't match any standard class exactly; use `vcpus`/`memoryMiB`) |
| Templates | No (boxd has no template API; use snapshots) |

## Testing

```bash
pnpm --filter @computesdk/boxd run test
```

Integration tests run only when `BOXD_API_KEY` is set. Without it, the shared conformance suite runs against a mock sandbox, and `boxd-sdk.test.ts` checks the adapter against a mocked `@boxd-sh/sdk` (create mapping, streaming, processes, snapshot readiness).
