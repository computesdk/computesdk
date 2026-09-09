# @computesdk/archil

[Archil](https://archil.com) provider for [ComputeSDK](https://www.computesdk.com).

`create` resolves a handle to an existing Archil disk id, and `runCommand`
executes shell commands in a managed container with that disk attached via the
control-plane `exec` endpoint. `destroy` is a no-op because disk lifecycle is
managed by Archil. `getById` requires a disk id.

## Installation

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

## Supported operations

| Method        | Supported | Notes                                                       |
| ------------- | --------- | ----------------------------------------------------------- |
| `create`      | ✅        | Resolves an existing disk from top-level `diskId`.          |
| `getById`     | ✅        | Requires the disk id.                                        |
| `list`        | ✅        | Lists all disks visible to the API key.                     |
| `destroy`     | no-op     | Disk lifecycle is managed by Archil.                        |
| `runCommand`  | ✅        | Executes shell commands through Archil's HTTP `exec` endpoint. |
| `getInfo`     | ✅        |                                                             |
| `getUrl`      | ❌        | Each exec runs in a fresh ephemeral container — no port to expose. |
| `filesystem`  | ✅        | Maps paths into `/mnt/archil` and manages shared-mode checkout/checkin automatically. |

## Limitations

- Each `exec` call provisions a fresh container — there is no persistent
  state between calls beyond what is written to the disk.
- Responses are truncated to ~5 MB by the Archil control plane.
- `getUrl` is not supported — each exec runs in a fresh ephemeral container,
  so there is no long-lived process to expose a port on.
- Filesystem operations accept normal absolute paths and map them into the
  `/mnt/archil` disk mount internally. Each mutating operation checks out and
  checks in the disk automatically.
- Raw `runCommand` strings are not rewritten. Commands that access the disk
  directly must use `/mnt/archil` themselves.
