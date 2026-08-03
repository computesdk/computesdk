# @computesdk/sail

[Sail](https://sailresearch.com) provider for ComputeSDK. Sailboxes are
isolated Firecracker microVM sandboxes with command execution, native
filesystem operations, and public HTTP or TCP listeners.

## Installation

```bash
npm install computesdk @computesdk/sail
```

Node.js 22 or newer is required by the Sail SDK.

## Configuration

Create a Sail API key at [app.sailresearch.com](https://app.sailresearch.com),
then export it:

```bash
export SAIL_API_KEY=your_sail_api_key
```

The provider accepts:

```typescript
interface SailConfig {
  apiKey?: string;
  app?: string;
  image?: ImageSpec | Image;
}
```

- `apiKey` falls back to `SAIL_API_KEY`.
- `app` owns the created Sailboxes and falls back to `SAIL_APP`, then
  `computesdk`. It is created on first use when missing.
- `image` defaults to Sail's ARM64 Devbox builtin, which includes Node.js and
  Bun. Pass another Sail image when the workload needs a different runtime or
  architecture.
- Creates default to an `S` Sailbox. Pass `size: 'm'` or `size: 'l'` to
  `create()` when the workload needs more compute.

## Usage

```typescript
import { sail } from '@computesdk/sail';

const compute = sail({ app: 'my-app' });

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/result.txt', result.stdout);
console.log(await sandbox.filesystem.readFile('/tmp/result.txt'));

await sandbox.destroy();
```

It can also be registered with ComputeSDK's shared client:

```typescript
import { compute } from 'computesdk';
import { sail } from '@computesdk/sail';

compute.setConfig({ provider: sail({ app: 'my-app' }) });
const sandbox = await compute.sandbox.create();
```

## Supported Operations

| Operation | Supported | Notes |
|---|---|---|
| `create` | Yes | Defaults to an ARM64 Devbox on `S`; supports `name`, `size`, `memoryGib`, and cancellation. |
| `getById` | Yes | Returns `null` for missing or terminated Sailboxes. |
| `list` | Yes | Scoped to the configured app. |
| `destroy` | Yes | Terminates the Sailbox. |
| `runCommand` | Yes | Supports cwd, environment, timeout, and background mode. |
| `getInfo` | Yes | Refreshes current lifecycle state. |
| `getUrl` | Yes | Exposes or reuses HTTP/HTTPS and TCP listeners. |
| Filesystem | Yes | Native read, write, mkdir, list, exists, and remove. |
| Templates | No | Configure a Sail `Image` on the provider instead. |
| Snapshots | No | Use the native Sail SDK for checkpoint operations. |

`getUrl` does not replace an existing listener because doing so would replace
its allowlist. A listener with a conflicting protocol produces an error.

ComputeSDK's create `timeout` is not supported: it represents a hard sandbox
lifetime, while Sail's autosleep only sleeps an idle Sailbox. Bound individual
commands with `runCommand`'s timeout or explicitly call `destroy()`.

Use `sandbox.getInstance()` for Sail-specific checkpoint, sleep, resume, SSH,
listener allowlist, and credential-injection APIs.
