# @computesdk/archil

[Archil](https://archil.com) provider for [ComputeSDK](https://www.computesdk.com).

The provider supports Archil's two compute surfaces, selected by the
`execution` config option:

- **`exec`** (default): `create` resolves a handle to an existing Archil disk
  id, and `runCommand` executes shell commands in a managed ephemeral
  container with that disk attached via the control-plane `exec` endpoint.
  `destroy` is a no-op because disk lifecycle is managed by Archil.
  `getById` requires a disk id.
- **`persistent`**: `create` provisions a persistent Archil sandbox — a
  long-running Linux VM with a dedicated disk — and waits until it is
  `running`. `runCommand` uses the sandbox's interactive process API over a
  short-lived WebSocket connection (a fresh connection URL is fetched per
  command, so expiry is handled automatically). `destroy` deletes the
  sandbox, `getById` fetches the sandbox and resumes it if paused, and
  `getUrl` resolves the sandbox's published endpoints.

## Installation

```bash
npm install @computesdk/archil
```

## Configuration

| Option      | Env var            | Required | Description                                    |
| ----------- | ------------------ | -------- | ----------------------------------------------- |
| `apiKey`    | `ARCHIL_API_KEY`   | yes      | Archil control-plane API key                    |
| `region`    | `ARCHIL_REGION`    | yes      | Archil region (e.g. `aws-us-east-1`)            |
| `baseUrl`   | —                  | no       | Override control-plane URL (for testing)        |
| `execution` | —                  | no       | `"exec"` (default) or `"persistent"`                |

## Usage

```ts
import { archil } from '@computesdk/archil';

const provider = archil();

// Attach to an existing disk by id.
const { sandbox } = await provider.sandbox.create({
  diskId: 'disk_abc123',
});

const result = await provider.sandbox.runCommand(sandbox, 'echo hello > /mnt/note && cat /mnt/note');
console.log(result.stdout); // "hello"

// Look up later by disk id:
const byId = await provider.sandbox.getById(sandbox.sandboxId);

await provider.sandbox.destroy(sandbox.sandboxId);
```

`create()` requires top-level `diskId` as the target disk id.

### Persistent mode

```ts
const provider = archil({ execution: 'persistent' });

const sandbox = await provider.sandbox.create({
  name: 'ci-job',
  baseImage: 'node:24-bookworm', // OCI image; `templateId` works too
  vcpus: 4,                      // or `cpu` / `cpus`
  memoryMiB: 8192,               // or `memory`
  env: { CI: '1' },
  maxTtlSeconds: 3600,           // per powered-on session
  sandbox: { /* extra Archil fields, e.g. network policy */ },
});

// cwd/env/installs and background processes persist between calls.
await sandbox.runCommand('npm ci', { cwd: '/repo' });
await sandbox.runCommand('npm test', { cwd: '/repo' });

// Paused sandboxes are resumed automatically on getById/runCommand.
const resumed = await provider.sandbox.getById(sandbox.sandboxId);

await provider.sandbox.destroy(sandbox.sandboxId); // deletes the sandbox
```

Sandbox `create` accepts generic `CreateSandboxOptions` fields (`vcpus`/`cpu`/`cpus`,
`memory`/`memoryMiB`, `templateId`, `timeout` (ms → `maxTtlSeconds`)) plus the
Archil-specific keys shown above.

### Choosing a mode

|                       | `exec`                          | `persistent`                                |
| --------------------- | ------------------------------- | ------------------------------------------- |
| Compute               | Ephemeral container per command | Persistent VM                               |
| `cwd`/`env`/installs  | Lost between commands           | Persist while running                       |
| Filesystem writes     | Only under `/mnt/archil`        | Anywhere on the VM                          |
| Background processes  | Die with the container          | Keep running                                |
| `create` input        | Existing `diskId`               | Sandbox spec (image, vcpus, memory, …)      |
| Billing               | Per `executeMs`                 | Per running wall-clock time                 |
| `getUrl`              | ❌                              | ✅ (published endpoints)                    |

## Supported operations

| Method        | exec mode | persistent mode |
| ------------- | --------- | ------------ |
| `create`      | ✅ Resolves an existing disk from top-level `diskId`. | ✅ Provisions a sandbox, waits for `running`. |
| `getById`     | ✅ Requires the disk id. | ✅ Fetches the sandbox; resumes if paused/stopped. |
| `list`        | ✅ Lists all disks visible to the API key. | ✅ Lists sandboxes. |
| `destroy`     | no-op — disk lifecycle is managed by Archil. | ✅ Deletes the sandbox and its backing disk. |
| `runCommand`  | ✅ Executes via the HTTP `exec` endpoint. | ✅ Executes via the process API (fresh connection URL per command). |
| `getInfo`     | ✅ | ✅ |
| `getUrl`      | ❌ Ephemeral containers have no port to expose. | ✅ Resolves the sandbox's endpoint for the port. |
| `filesystem`  | ✅ Maps paths into `/mnt/archil`; manages shared-mode checkout/checkin. | ✅ Uses the sandbox file transfer API; paths are the VM's real paths. |

## Limitations

- **exec mode**: each `exec` call provisions a fresh container — there is no
  persistent state between calls beyond what is written to the disk.
- **exec mode**: responses are truncated to ~5 MB by the Archil control plane.
- **exec mode**: `getUrl` is not supported — each exec runs in a fresh
  ephemeral container, so there is no long-lived process to expose a port on.
- **exec mode**: filesystem operations accept normal absolute paths and map
  them into the `/mnt/archil` disk mount internally. Each mutating operation
  checks out and checks in the disk automatically. Raw `runCommand` strings
  are not rewritten — commands that access the disk must use `/mnt/archil`
  themselves.
- **persistent mode**: `pause`/`resume`/`fork` are available on the underlying
  `disk`-SDK sandbox via `getInstance()` — the generic provider interface has
  no `pause`/`resume` methods, so only `getById`/`runCommand` auto-resume.
