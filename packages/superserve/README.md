# @computesdk/superserve

Superserve provides sandbox infrastructure to run code in isolated cloud
environments powered by Firecracker MicroVMs.

## Installation

```bash
npm install computesdk @computesdk/superserve
```

## Setup

1. Get your Superserve API key from [console.superserve.ai](https://console.superserve.ai).
2. Set the environment variable:

```bash
export SUPERSERVE_API_KEY=your_api_key_here
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { superserve } from '@computesdk/superserve';

compute.setConfig({
  provider: superserve({ apiKey: process.env.SUPERSERVE_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('node -v');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { superserve } from '@computesdk/superserve';

const provider = superserve({ apiKey: process.env.SUPERSERVE_API_KEY });
const { sandbox } = await provider.sandbox.create();
```

## Configuration

```typescript
superserve({
  apiKey: string,      // optional, falls back to SUPERSERVE_API_KEY
  baseUrl: string,     // optional, falls back to SUPERSERVE_BASE_URL,
                       //   then 'https://api.superserve.ai'
  timeout: number,     // optional default sandbox idle timeout (ms)
})
```

## Features

| Feature | Supported |
|---|---|
| Sandbox lifecycle (create / connect / list / destroy) | ✅ |
| Command execution with cwd, env, and timeout | ✅ |
| Filesystem (read, write, mkdir, readdir, exists, remove) | ✅ |
| Templates (boot from named template) | ✅ |
| Pause / resume (in-place state preservation) | ✅ via `@superserve/sdk` |
| Snapshots as forkable resources | ❌ Use templates instead |
| Arbitrary port forwarding (`getUrl`) | ❌ Run a reverse-proxy inside the sandbox |
| Template build (`template.create`) | ❌ Use `@superserve/sdk` `Template.create` |

## API Reference

### `sandbox.create(options?)`

Boots a new microVM. Common options:

```typescript
await compute.sandbox.create({
  templateId: 'superserve/python-3.11',    // optional, defaults to superserve/base
  timeout: 60_000,                          // idle timeout in ms
  envs: { API_KEY: 'value' },
  name: 'my-sandbox',
  metadata: { source: 'ci' },
});
```

Curated templates include `superserve/base`, `superserve/python-3.11`,
`superserve/node-22`, and others — see the
[Superserve docs](https://docs.superserve.ai) for the full list.

### `sandbox.runCommand(command, options?)`

```typescript
const result = await sandbox.runCommand('npm install', {
  cwd: '/app',
  env: { NODE_ENV: 'production' },
  timeout: 120_000,
});

console.log(result.exitCode);
console.log(result.stdout);
console.log(result.stderr);
```

### `sandbox.filesystem`

```typescript
await sandbox.filesystem.writeFile('/app/config.json', '{"key":"value"}');
const text = await sandbox.filesystem.readFile('/app/config.json');
await sandbox.filesystem.mkdir('/app/data');
const entries = await sandbox.filesystem.readdir('/app');
const present = await sandbox.filesystem.exists('/app/config.json');
await sandbox.filesystem.remove('/app/config.json');
```

`readFile` and `writeFile` go directly to the per-sandbox data plane.
`mkdir`, `readdir`, `exists`, and `remove` are implemented via shell
fallbacks against `sandbox.runCommand` until the data plane exposes
native filesystem operations.

### `sandbox.getInfo()` / `sandbox.destroy()`

```typescript
const info = await sandbox.getInfo();
console.log(info.id, info.status);

await sandbox.destroy();
```

Status mapping: Superserve's `paused` state is reported as ComputeSDK's
`stopped`, `failed` as `error`, and `active` / `resuming` as `running`.

### `provider.sandbox.list()` and `getById(id)`

```typescript
const items = await provider.sandbox.list();      // read-only, no side effects
const { sandbox } = await provider.sandbox.getById(items[0].sandboxId);
```

`list()` is read-only — it returns `SandboxInfo` stubs without opening a
session. To actually operate on a listed entry, call `getById(id)`.

Note that `getById()` issues `POST /activate` on the sandbox, which
**auto-resumes paused sandboxes** and rotates their access token. If you
only need read-only metadata, prefer iterating the result of `list()`
directly.

### Templates

```typescript
const templates = await provider.template.list();
```

To **create** a template, use `@superserve/sdk` directly — templates
require a build spec (`from` + `steps`), which the ComputeSDK
`template.create({ name })` shape doesn't carry.

## Error Handling

Common errors and how to recover:

```typescript
try {
  const sandbox = await compute.sandbox.create();
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes('authentication')) {
    // Bad or missing SUPERSERVE_API_KEY
  } else if (msg.includes('quota') || msg.includes('limit')) {
    // Team has hit its concurrent-sandbox cap
  } else {
    // Network or transient platform error — safe to retry with backoff
  }
}
```

Authentication failures are normalized into a single user-facing message
regardless of underlying cause (HTTP 401, missing key, `AuthenticationError`
from the SDK).

## Examples

A runnable example lives in [`examples/basic`](../../examples/basic):

```bash
cd examples/basic
export SUPERSERVE_API_KEY=your_key
pnpm superserve
```

## Learn more

- [Superserve docs](https://docs.superserve.ai)
- [`@superserve/sdk`](https://www.npmjs.com/package/@superserve/sdk)
- [ComputeSDK](https://github.com/computesdk/computesdk)

## License

MIT
