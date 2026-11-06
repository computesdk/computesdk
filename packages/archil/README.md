# @computesdk/archil

[Archil](https://archil.com) provider for [ComputeSDK](https://www.computesdk.com).

Archil sandboxes are persistent Linux VMs, and that is what this provider
creates by default:

- `create()` provisions a VM and waits until it is `running`. `getById`
  fetches a VM (resuming it if paused or stopped), `list` returns the
  account's VMs, and `destroy` stops and deletes one.
- `runCommand`, streaming (`onStdout`/`onStderr`) and `startProcess` run on
  Archil's native process API over a short-lived WebSocket (a fresh connection
  URL per process). Files move through Archil's native file transfer API.
- Snapshots are paused forks of a VM; `create({ snapshotId })` restores one
  into a new VM. `pause()`/`resume()` are on `sandbox.getInstance()`.

The older disk exec surface (a fresh container per command with an existing
disk mounted at `/mnt/archil`) is still available as an explicit opt-in; see
[Exec mode](#exec-mode-opt-in).

## Installation

```bash
npm install @computesdk/archil
```

## Configuration

| Option      | Env var            | Required | Description                                          |
| ----------- | ------------------ | -------- | ---------------------------------------------------- |
| `apiKey`    | `ARCHIL_API_KEY`   | yes      | Archil control-plane API key                         |
| `region`    | `ARCHIL_REGION`    | yes      | Archil region (e.g. `aws-us-east-1`)                 |
| `baseUrl`   | —                  | no       | Override control-plane URL (for testing)             |
| `execution` | `ARCHIL_EXECUTION` | no       | `"persistent"` (default) or `"exec"` (disk exec)     |

## Usage

```ts
import { archil } from '@computesdk/archil';

const provider = archil();

const sandbox = await provider.sandbox.create({
  name: 'ci-job',
  baseImage: 'node:24-bookworm', // OCI image; `image` / `templateId` work too
  vcpus: 4,                      // or `cpu` / `cpus`, or `sizeClass: 'lg'`
  memoryMiB: 8192,               // or `memory`
  env: { CI: '1' },              // or `envs`
  maxTtlSeconds: 3600,           // or `timeout` in ms; per powered-on session
  sandbox: { /* extra Archil create fields */ },
});

// Filesystem state, installs and background processes persist between calls.
// `cwd` and `env` apply to every part of a compound command.
await sandbox.runCommand('npm ci && npm test', { cwd: '/repo', env: { CI: '1' } });

// Native streaming and processes.
await sandbox.runCommand('npm run build', { onStdout: (c) => process.stdout.write(c) });
const proc = await sandbox.startProcess('cat', { stdin: true });
await proc.write('hello\n');
await proc.closeStdin();
await proc.wait();

// Pause/resume the same VM (memory and disk preserved).
const vm = sandbox.getInstance();
await vm.pause!();
await vm.resume!();

await provider.sandbox.destroy(sandbox.sandboxId);
```

The shared `ephemeral` create option overrides the configured mode per sandbox:
`ephemeral: true` resolves an exec-mode disk handle (requires `diskId`),
`ephemeral: false` provisions a VM.

### Snapshots

```ts
const snapshot = await provider.snapshot.create(sandbox.sandboxId, { name: 'golden' });
const restored = await provider.sandbox.create({ snapshotId: snapshot.id });
const snapshots = await provider.snapshot.list();

// Archil deletes forks before their parent (it returns 409 otherwise):
await provider.sandbox.destroy(restored.sandboxId);
await provider.snapshot.delete(snapshot.id);
await provider.sandbox.destroy(sandbox.sandboxId);
```

A snapshot is a fork of the source VM's memory and disk, paused so it holds
state without running, and named `csdk-snap-<name>-<suffix>`. `snapshot.list()`
returns VMs with that prefix and `sandbox.list()` leaves them out. Restoring
forks the snapshot again into an independent VM. Snapshot ids are ordinary
Archil sandbox ids, so any VM id can be passed as `snapshotId`.

## Exec mode (opt-in)

```ts
const provider = archil({ execution: 'exec' }); // or ARCHIL_EXECUTION=exec

const sandbox = await provider.sandbox.create({ diskId: 'dsk-0000000000000000' });
await sandbox.runCommand('echo hello > /mnt/archil/note && cat /mnt/archil/note');
```

Each command runs in a fresh Archil-managed container with the disk mounted at
`/mnt/archil`. `create()` requires `diskId`; passing `diskId` without opting in
throws. `getById`/`list` operate on disks, `destroy` is a no-op (disk lifecycle
is managed by Archil), and ids starting with `dsk-` are always treated as disk
handles. `cwd`, `env` and installs do not persist between commands.

## Supported operations

| Method            | Persistent VM (default) | Exec mode (opt-in) |
| ----------------- | ----------------------- | ------------------ |
| `create`          | ✅ Provisions a VM, waits for `running`. | ✅ Resolves an existing disk from `diskId`. |
| `getById`         | ✅ Fetches the VM; resumes if paused/stopped. | ✅ Fetches the disk. |
| `list`            | ✅ All VMs on the account, minus snapshots. | ✅ All disks visible to the API key. |
| `destroy`         | ✅ Stops and deletes the VM. | no-op |
| `runCommand`      | ✅ Native process API. | ✅ HTTP `exec` endpoint. |
| Streaming         | ✅ Native, live over the process WebSocket. | Output delivered when the command exits. |
| `startProcess`    | ✅ Native (stdin, kill, wait). | ❌ |
| `filesystem`      | ✅ Native file transfer for read/write; `mkdir`/`readdir`/`exists`/`remove` run shell commands. | ✅ Maps paths into `/mnt/archil`. |
| Snapshots         | ✅ create / list / delete / restore. | ❌ |
| `pause`/`resume`  | ✅ On `getInstance()`. | ❌ |
| `getUrl`          | Only for ports already published as sandbox endpoints (not proven live). | ❌ |

## Limitations

- `list()` is one Archil API call: Archil's sandbox list endpoint returns every
  sandbox in a single response (there is no cursor to page through).
- `kill(signal)` on a native process cancels it through Archil's process
  control; Archil does not accept a signal name, so the result reports the
  requested signal (`SIGKILL` by default) with exit code 137. Timed-out
  commands report exit code 124.
- A VM with live forks (snapshots or VMs restored from it) cannot be deleted
  until those forks are deleted.
- Exec mode: responses are truncated to ~5 MB by the Archil control plane, and
  raw `runCommand` strings are not rewritten — commands that access the disk
  must use `/mnt/archil` themselves.

## Standard sizes (persistent VMs only)

`archil().sizes.list()` / `resolve('sm')` declares exact `sm`, `md`, `lg`, and
`xl` requests. `create({ sizeClass: 'sm' })` maps to adapter `vcpus: 1`,
`memoryMiB: 2048`, then native `vcpuCount` / `memSizeMiB`. Exec mode
(`execution: 'exec'` or `ephemeral: true`) reports `unavailable` for VM sizing. Attach (`sandboxId`/`instanceId`)
and fork (`snapshotId`) standard requests reject as `unsupported` before API calls;
those paths cannot apply a new VM size. Conflicting native controls reject too.
`xs`/`2xl` remain `unknown` in this initial adapter catalog.

The persistent API documents 1–32 vCPUs and 256–65536 MiB, but adapter declarations
are not account/quota/region guarantees or measurements. Discovery is pure and
needs no credentials. Successful standardized creates expose frozen
`instance.sizing` request metadata, not observed CPU/RAM. Local mock coverage uses
the installed `disk` SDK; it does not certify separately locked consumer versions
or published artifacts. Legacy creates without `sizeClass` remain unchanged.
