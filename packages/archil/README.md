# @computesdk/archil

[Archil](https://archil.com) provider for [ComputeSDK](https://www.computesdk.com).

`create` provisions a new Archil disk (no mounts — archil-managed storage)
and `runCommand` executes shell commands in a managed container with that
disk attached via the control-plane `exec` endpoint. `destroy` deletes the
disk. `getById` accepts either a disk id or a disk name.

## Install

```bash
npm install @computesdk/archil
```

The provider talks to the Archil control plane directly over HTTP — no
additional Archil SDK is required.

## Configuration

| Option    | Env var            | Required | Description                                |
| --------- | ------------------ | -------- | ------------------------------------------ |
| `apiKey`  | `ARCHIL_API_KEY`   | yes      | Archil control-plane API key               |
| `region`  | `ARCHIL_REGION`    | yes      | Archil region (e.g. `aws-us-east-1`)       |
| `baseUrl` | —                  | no       | Override control-plane URL (for testing)   |

## Usage

```ts
import { archil } from '@computesdk/archil';

const provider = archil();

// Create a fresh disk. Pass a name to control it; omit for auto-generated.
const { sandbox } = await provider.sandbox.create({ name: 'my-workspace' });

const result = await provider.sandbox.runCommand(sandbox, 'echo hello > /mnt/note && cat /mnt/note');
console.log(result.stdout); // "hello"

// Look up later by name or by id:
const byName = await provider.sandbox.getById('my-workspace');
const byId = await provider.sandbox.getById(sandbox.sandboxId);

await provider.sandbox.destroy(sandbox.sandboxId);
```

Disk names must match `^[a-zA-Z0-9_-]+$` and be 1–100 characters.

## Supported operations

| Method        | Supported | Notes                                                       |
| ------------- | --------- | ----------------------------------------------------------- |
| `create`      | ✅        | Creates a new disk with archil-managed storage (no mounts). |
| `getById`     | ✅        | Accepts either the disk id or the disk name.                |
| `list`        | ✅        | Lists all disks visible to the API key.                     |
| `destroy`     | ✅        | Deletes the disk.                                           |
| `runCommand`  | ✅        | Calls Archil's HTTP `exec` endpoint and waits for completion. |
| `runCode`     | ✅        | Wraps code in `node -e` or `python3 -c`. Requires explicit `runtime`. |
| `getInfo`     | ✅        |                                                             |
| `getUrl`      | ❌        | Each exec runs in a fresh ephemeral container — no port to expose. |
| `filesystem`  | ✅        | Implemented via shell commands (`cat`, `find`, `mkdir`, etc.). |

## Limitations

- Each `exec` call provisions a fresh container — there is no persistent
  state between calls beyond what is written to the disk.
- Responses are truncated to ~5 MB by the Archil control plane.
- `getUrl` is not supported — each exec runs in a fresh ephemeral container,
  so there is no long-lived process to expose a port on.
- Filesystem operations are implemented as shell commands, so each call
  costs one HTTP round trip.
