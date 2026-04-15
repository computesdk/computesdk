# @computesdk/archil

[Archil](https://archil.com) provider for [ComputeSDK](https://www.computesdk.com).

Archil exposes an HTTP `exec` endpoint that runs a shell command in a managed
container with the configured Archil disk mounted, then returns `stdout`,
`stderr`, and `exitCode`. There is no sandbox lifecycle to manage — `create`
just resolves a handle to an existing disk.

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
| `region`  | `ARCHIL_REGION`    | yes      | Archil region (e.g. `us-east-1`)           |
| `diskId`  | —                  | yes¹     | Default disk ID to exec against            |
| `baseUrl` | —                  | no       | Override control-plane URL (for testing)   |

¹ A `diskId` must be supplied either at construction or per call via
`provider.sandbox.create({ sandboxId: '<diskId>' })` /
`provider.sandbox.getById('<diskId>')`.

## Usage

```ts
import { archil } from '@computesdk/archil';

const provider = archil({ diskId: 'disk_abc123' });

const { sandbox } = await provider.sandbox.create();

const result = await provider.sandbox.runCommand(sandbox, 'ls -la /mnt');
console.log(result.stdout);
```

## Supported operations

| Method        | Supported | Notes                                                       |
| ------------- | --------- | ----------------------------------------------------------- |
| `create`      | ✅        | Resolves an existing disk; does not create one.             |
| `getById`     | ✅        |                                                             |
| `list`        | ✅        | Lists all disks visible to the API key.                     |
| `destroy`     | no-op     | Disks have an independent lifecycle. Use the Archil SDK.    |
| `runCommand`  | ✅        | Calls `Disk.exec()` (HTTP, blocks until command completes). |
| `runCode`     | ✅        | Wraps code in `node -e` or `python3 -c`.                    |
| `getInfo`     | ✅        |                                                             |
| `getUrl`      | ❌        | Each exec runs in a fresh ephemeral container — no port to expose. |
| `filesystem`  | ✅        | Implemented via shell commands (`cat`, `find`, `mkdir`, etc.). |

## Limitations

- Each `exec` call provisions a fresh container — there is no persistent state
  between calls beyond what is written to the mounted disk.
- Responses are truncated to ~5 MB by the Archil control plane.
- `getUrl` is not supported — each exec runs in a fresh ephemeral container,
  so there is no long-lived process to expose a port on.
- Filesystem operations are implemented as shell commands, so each call costs
  one HTTP round trip.
