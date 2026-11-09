# @computesdk/tangle

[Tangle Sandbox](https://sandbox.tangle.tools) provider for ComputeSDK: isolated Linux sandboxes with command execution, filesystem access and port URLs, built on the `@tangle-network/sandbox` SDK.

## Installation

Requires Node.js 20.19 or newer.

```bash
npm install @computesdk/tangle
```

## Configuration

| Option | Environment variable | Default |
|---|---|---|
| `apiKey` | `TANGLE_API_KEY` | required |
| `baseUrl` | `TANGLE_SANDBOX_BASE_URL` | `https://sandbox.tangle.tools` |
| `image` | | server default image |
| `cpu`, `memory` (MB), `disk` (GB) | | server default shape |
| `timeout` (ms) | | server default lifetime |

Per-create `image`, `templateId` (a saved Tangle template), `cpu`, `memory`, `disk`, `timeout`, `name`, `envs`, `metadata`, `ephemeral` and `idempotencyKey` override the defaults.

## Usage

```typescript
import { tangle } from '@computesdk/tangle';

const compute = tangle({ apiKey: process.env.TANGLE_API_KEY });

const sandbox = await compute.instances.create({ image: 'node:22' });
try {
  const result = await sandbox.runCommand('node --version');
  console.log(result.stdout);

  await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from Tangle');
  console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

  console.log(await sandbox.getUrl({ port: 3000 }));
} finally {
  await sandbox.destroy();
}
```

## Supported operations

- `instances.create`, `getById`, `list` (deleted sandboxes omitted), `destroy`
- `runCommand` with `cwd`, `env`, `timeout` and `background`; a foreground `timeout` defaults to 600000 ms (10 minutes), the runtime's maximum, and must be a whole number of ms from 100 to 600000; a background command has no limit unless `timeout` is set
- `filesystem`: `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`
- `getUrl`, through the SDK's port exposure
- `getInstance()` returns the native `SandboxInstance` for other SDK features

## Not supported

- `snapshotId` on create throws; use the native SDK for snapshots.
- `runtime` names throw; pick an image such as `node:22` or `python:3.12-slim`.

## Tests

```bash
pnpm --filter @computesdk/tangle test
```

Without `TANGLE_API_KEY` the suite runs against ComputeSDK's mock sandbox. With it, every test creates and destroys a real sandbox.
