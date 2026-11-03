# computesdk

The universal SDK for running code in remote sandboxes.

> Gateway/control-plane transport has been removed from `computesdk`.
> Configure `compute` with `provider` or `providers`, or use provider packages directly.

## Installation

```bash
npm install computesdk
```

## Quick Start

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';

compute.setConfig({
  provider: e2b({
    apiKey: process.env.E2B_API_KEY,
  }),
});

const sandbox = await compute.instances.create();

// Execute code
const result = await sandbox.runCommand('python -c "print(\"Hello World!\")"');
console.log(result.stdout); // "Hello World!"

// Clean up
await sandbox.destroy();
```

### Multi-Provider Configuration

Configure multiple providers for resilience and routing:

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

compute.setConfig({
  providers: [
    e2b({ apiKey: process.env.E2B_API_KEY }),
    modal({
      tokenId: process.env.MODAL_TOKEN_ID,
      tokenSecret: process.env.MODAL_TOKEN_SECRET,
    }),
  ],
  providerStrategy: 'round-robin', // or 'priority'
  fallbackOnError: true,
});

// Uses configured strategy
const sandbox = await compute.instances.create();

// Force a specific provider for one call
const modalSandbox = await compute.instances.create({ provider: 'modal' });
```

## API Reference

### Configuration

#### `compute.setConfig(config)`

Configure `compute` with `provider` or `providers`.

```typescript
compute.setConfig({
  provider: e2b({
    apiKey: process.env.E2B_API_KEY,
  }),
});
```

`compute(...)` callable mode is also supported:

```typescript
const scopedCompute = compute({
  provider: vercel({
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
  }),
});

const sandbox = await scopedCompute.sandbox.create();
```

Multi-provider config shape:

```typescript
compute.setConfig({
  providers: [e2b({...}), modal({...})],
  providerStrategy: 'priority', // default: 'priority'
  fallbackOnError: true,        // default: true
});
```

You can also combine both `provider` and `providers`:

```typescript
compute.setConfig({
  provider: e2b({...}),         // primary provider (first choice)
  providers: [modal({...})],    // fallback/secondary providers
});
```

When both are present, `provider` is treated as the primary provider and is placed first.

### Sandbox Management

#### `compute.instances.create(options?)`

Create a new sandbox.

```typescript
const sandbox = await compute.instances.create();

// With options
const sandbox = await compute.instances.create({
  timeout: 300000, // 5 minutes
  metadata: { userId: '123' },
  namespace: 'my-org',
  name: 'my-sandbox',
});
```

**Options:**
- `timeout?: number` - Timeout in milliseconds
- `metadata?: Record<string, any>` - Custom metadata
- `envs?: Record<string, string>` - Environment variables
- `namespace?: string` - Namespace for organizing sandboxes
- `name?: string` - Human-readable name for the sandbox

> **Note:** Not every provider honors every option. Support for fields like `name`, `metadata`, and `envs` depends on the underlying provider SDK — some pass them through, some map them to a different field, and some ignore them silently. Check your provider package's README for the exact set of options it respects.

#### `compute.instances.getById(instanceId)`

Get an existing sandbox by ID.

```typescript
const sandbox = await compute.instances.getById('sandbox-id');
```

### Sandbox Operations

#### `sandbox.runCommand(command, options?)`

Run a shell command.

```typescript
const result = await sandbox.runCommand('npm install express');
console.log(result.stdout);
console.log(result.exitCode);

// With options
const result = await sandbox.runCommand('npm install', {
  cwd: '/app',
  env: { NODE_ENV: 'production' },
  background: true,
});
```

#### `sandbox.destroy()`

Destroy the sandbox and clean up resources.

```typescript
await sandbox.destroy();
```

### Filesystem Operations

The sandbox provides full filesystem access:

#### `sandbox.filesystem.writeFile(path, content)`

Write a file to the sandbox.

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
```

#### `sandbox.filesystem.readFile(path)`

Read a file from the sandbox.

```typescript
const content = await sandbox.filesystem.readFile('/tmp/hello.py');
console.log(content); // 'print("Hello World")'
```

#### `sandbox.filesystem.mkdir(path)`

Create a directory.

```typescript
await sandbox.filesystem.mkdir('/tmp/mydir');
```

#### `sandbox.filesystem.readdir(path)`

List directory contents.

```typescript
const files = await sandbox.filesystem.readdir('/tmp');
console.log(files); // [{ name: 'hello.py', type: 'file', size: 123 }, ...]
```

#### `sandbox.filesystem.exists(path)`

Check if a file or directory exists.

```typescript
const exists = await sandbox.filesystem.exists('/tmp/hello.py');
console.log(exists); // true
```

#### `sandbox.filesystem.remove(path)`

Remove a file or directory.

```typescript
await sandbox.filesystem.remove('/tmp/hello.py');
```

## Examples

### Multi-Step Build Process

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();

// Create project structure
await sandbox.filesystem.mkdir('/app');
await sandbox.filesystem.mkdir('/app/src');

// Write package.json
await sandbox.filesystem.writeFile('/app/package.json', JSON.stringify({
  name: 'my-app',
  version: '1.0.0',
  dependencies: {
    'express': '^4.18.0'
  }
}, null, 2));

// Write source code
await sandbox.filesystem.writeFile('/app/src/index.js', `
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello World!' });
});

console.log('Server ready!');
`);

// Install dependencies
const installResult = await sandbox.runCommand('npm install', { cwd: '/app' });
console.log('Install:', installResult.stdout);

// Run the app
const runResult = await sandbox.runCommand('node src/index.js', { cwd: '/app' });

console.log(runResult.stdout);

await sandbox.destroy();
```

### Using Different Providers

```typescript
import { compute } from 'computesdk';
import { e2b } from '@computesdk/e2b';
import { modal } from '@computesdk/modal';

// Use E2B for data science
compute.setConfig({
  provider: e2b({ apiKey: process.env.E2B_API_KEY }),
});

const e2bSandbox = await compute.instances.create();
await e2bSandbox.runCommand('python -c "import pandas as pd; print(pd.__version__)"');
await e2bSandbox.destroy();

// Switch to Modal for GPU workloads
compute.setConfig({
  provider: modal({
    tokenId: process.env.MODAL_TOKEN_ID,
    tokenSecret: process.env.MODAL_TOKEN_SECRET,
  }),
});

const modalSandbox = await compute.instances.create();
await modalSandbox.runCommand('python -c "import torch; print(torch.cuda.is_available())"');
await modalSandbox.destroy();
```

## Error Handling

```typescript
try {
  const sandbox = await compute.instances.create();
  const result = await sandbox.runCommand('invalid python code');
} catch (error) {
  console.error('Execution failed:', error.message);
  
  // Check for specific error types
  if (error.message.includes('No provider instance configured')) {
    console.error('Configure compute.setConfig({ provider: e2b({...}) }) first');
  }
}
```

## Provider Packages (Advanced)

For advanced use cases where you want to use provider SDKs directly, see individual provider packages:

- **[@computesdk/e2b](../e2b)** - E2B provider
- **[@computesdk/modal](../modal)** - Modal provider
- **[@computesdk/vercel](../vercel)** - Vercel provider
- **[@computesdk/daytona](../daytona)** - Daytona provider

Example direct mode usage:

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({ apiKey: 'your_api_key' });
const sandbox = await compute.instances.create();
```

## Building Custom Providers

Want to add support for a new compute provider? See **[@computesdk/provider](../provider)** for the provider framework and documentation on building custom providers.

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type { 
  InstanceInterface,
  InstanceInfo,
  CodeResult,
  CommandResult,
  CreateInstanceOptions
} from 'computesdk';
```

## License

MIT

## Standard CPU/RAM requests

Use the additive `sizeClass` option, **not** the provider-native `size` string:

```ts
import { compute, INSTANCE_SIZE_PROFILES, InstanceSizeError } from 'computesdk';
import { namespace } from '@computesdk/namespace';

const provider = namespace({ token: '...' });
// Pure local discovery: no vendor API calls, account checks, builds, or creates.
const catalog = provider.sizes.list();
const plan = provider.sizes.resolve('sm');
if (plan.status === 'supported') {
  const instance = await compute({ provider }).instances.create({ sizeClass: 'sm' });
  console.log(instance.sizing); // requested/resolved REQUEST, never observed hardware
}
```

Canonical targets (RAM is MiB; 1024 MiB = 1 GiB):

| sizeClass | vCPUs | RAM MiB |
| --- | ---: | ---: |
| `xs` | 1 | 1024 |
| `sm` | 1 | 2048 |
| `md` | 2 | 4096 |
| `lg` | 4 | 8192 |
| `xl` | 8 | 16384 |
| `2xl` | 16 | 32768 |

`sm`/`md`/`lg`/`xl` preserve the benchmark's historical S/M/L/XL targets.
Only Namespace Linux amd64 and **new persistent Archil VMs** initially declare
those four mappings. `xs` and `2xl` are defined targets but remain `unknown` in
these adapters. Other adapters default to `unknown`, not guessed support.
Archil exec is `unavailable`; attaching or forking an existing VM with a standard
size is `unsupported` because those paths do not resize it.

Resolution statuses are `supported`, `unconfigured`, `unavailable`,
`requires-build`, `unknown`, and `unsupported`. `supported` means only an
**adapter-declared exact native request translation**. It does not guarantee
quota, regional capacity, account eligibility, successful creation, or measured
CPU/RAM. Missing template bindings can be `unconfigured`; a required resource
artifact can be `requires-build`. No image builds are performed automatically.

A standard request rejects invalid runtime values, unverified mappings, and
conflicting native CPU/RAM/tier options (including `size`) **before creation**.
Catch `InstanceSizeError` and inspect `.code` (`invalid`, `conflict`, or a blocked
status), `.resolution` when present, and `.fallback === false`. Standard requests
do not fall back to another provider/default size, even on subsequent create
failure. In multi-provider configurations explicitly choose `provider` when
necessary; discovery does not automatically select a provider.

`instance.sizing` contains frozen `requested`, `resolved` CPU/RAM, and
`provenance: 'adapter-declared'` metadata only for a successful standardized
create. It is absent for legacy creates and get/list/attach handles; it is not
observed-resource telemetry. Creates without `sizeClass` retain native options,
defaults, and legacy `sandbox` aliases unchanged.

This is an SDK foundation, not a benchmark-runner migration: consumers must use a
released compatible SDK and independently plan blocked/skipped work. Existing
benchmark mappings, published artifacts, and live CI results are not changed by
this API alone. Mock tests validate the local source/installed native SDK only,
not cloud availability or the bytes of separately pinned consumer dependencies.

### `fallbackOnError` and provider selection

`sizeClass` pins the provider chosen by the existing priority, round-robin, or
explicit-provider selection policy. `fallbackOnError: true` is overridden for
that request: a selected unknown/unavailable provider rejects even if a later
provider supports the class. Native authentication/capacity/create errors also
stop after that one provider and retain their original error identity/flags;
they are not relabeled as `InstanceSizeError`. Requests without `sizeClass` retain
legacy fallback behavior. For example, use `{ sizeClass: 'md', provider:
'namespace' }` to explicitly select Namespace in a multi-provider compute client.

Supported `sizes.resolve` results separately expose `nativeOptions`: an
operational **resource-only patch**, not a complete create body. The factory
applies flat fields and merges the known Namespace `instanceOptions.shape` path,
preserving unrelated native input. Unsafe keys/accessors on these standard
resource paths are rejected; legacy requests bypass this validation.
`instance.sizing` deliberately excludes this operational payload and all caller
env, metadata, authorization and native passthrough fields, so request telemetry
does not promote arbitrary caller secrets into public sizing metadata.

Unknown/unconfigured/build-required mappings do not establish that a native size
is impossible or authorize shrinking a benchmark matrix. Keep requested coverage
visible: unresolved cells require investigation/configuration, not removal to
produce a green result. This initial two-adapter foundation does not claim the
previous benchmark mapping gaps or live CI failures are all fixed.

For a defined standard request, root options and the bounded resource context
must be plain objects with safe, **enumerable own string-key data properties**.
Non-enumerable fields (including `sizeClass` or `signal`), symbol keys, accessors,
and callable options reject before routing/spreading can lose or invoke them.
Namespace platform selectors must also be strings when present. These rules apply
only to standard requests; missing/undefined `sizeClass` keeps legacy behavior.
