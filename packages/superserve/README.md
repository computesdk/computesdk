# @computesdk/superserve

Superserve provider for ComputeSDK — execute code in fast Firecracker microVM
sandboxes with full filesystem support and per-team isolation.

## Installation

```bash
npm install @computesdk/superserve
```

## Setup

1. Get your Superserve API key from [console.superserve.ai](https://console.superserve.ai)
2. Set the environment variable:

```bash
export SUPERSERVE_API_KEY=your_api_key_here
```

## Quick Start

Configure `compute` with the Superserve provider and create a sandbox:

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

## Templates

Boot a sandbox from a curated or team-owned template:

```typescript
const { sandbox } = await provider.sandbox.create({
  templateId: 'superserve/python-3.11',
});
```

Curated templates include `superserve/base`, `superserve/python-3.11`,
`superserve/node-22`, and others. Defaults to `superserve/base` when
omitted.

## Filesystem

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
fallbacks against `sandbox.commands.run` until the data plane exposes
native filesystem operations.

## Not currently supported

- **`sandbox.getUrl(port)`** — Superserve does not currently expose
  arbitrary port forwarding. Use `sandbox.commands.run()` to interact
  with services inside the sandbox.
- **`snapshot.create / list / delete`** — Superserve has pause/resume
  for in-place state preservation but does not yet expose snapshots as
  forkable resources. Use templates for reusable base images.
- **`template.create({ name })`** — Templates require a build spec.
  Use `@superserve/sdk`'s `Template.create({ name, from, steps })`
  directly, or define templates via the Superserve console.

## Learn more

- [Superserve docs](https://docs.superserve.ai)
- [`@superserve/sdk`](https://www.npmjs.com/package/@superserve/sdk)
- [ComputeSDK](https://github.com/computesdk/computesdk)
