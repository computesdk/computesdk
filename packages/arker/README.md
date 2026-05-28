# @computesdk/arker

Arker provider for ComputeSDK — run code in [Arker](https://arker.ai) sandboxed VMs with persistent per-VM filesystems.

## Installation

```bash
npm install @computesdk/arker
```

## Setup

1. Get your Arker API key (starts with `ark_`) from [arker.ai](https://arker.ai).
2. Set the environment variable:

```bash
export ARKER_API_KEY=ark_live_your_api_key_here
```

By default the provider targets the `aws-us-east-1` region. Select another region with `region` / `ARKER_REGION`.

## Quick Start

Configure `compute` with the Arker provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { arker } from '@computesdk/arker';

compute.setConfig({
  provider: arker({ apiKey: process.env.ARKER_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('node -v');
console.log(result.stdout); // v18.x

await sandbox.destroy();
```

Or call the provider factory directly when you only need one provider:

```typescript
import { arker } from '@computesdk/arker';

const sdk = arker({ apiKey: process.env.ARKER_API_KEY });
const sandbox = await sdk.sandbox.create();
```

## How sandboxes are created

Arker disables direct VM creation — every sandbox is **forked from a golden source image**. `create()` forks `ubuntu-small` (Node.js + Python preinstalled) by default. Choose a different golden via `source` in config or `templateId` in create options:

```typescript
// Default: forks the `ubuntu-small` golden
const sandbox = await sdk.sandbox.create();

// Pick a golden globally for this provider
const py = arker({ apiKey, source: 'ubuntu-py-repl' });

// Or per sandbox
const sandbox = await sdk.sandbox.create({ templateId: 'ubuntu-js-repl' });
```

## Configuration

### Environment Variables

```bash
export ARKER_API_KEY=ark_live_your_api_key_here
export ARKER_REGION=aws-us-east-1     # optional, this is the default
export ARKER_SOURCE=ubuntu-small      # optional default golden
```

### Configuration Options

```typescript
interface ArkerConfig {
  /** Arker API key (starts with `ark_`). Falls back to ARKER_API_KEY. */
  apiKey?: string;
  /** Region, e.g. `aws-us-east-1`. Falls back to ARKER_REGION, then the us-east-1 default. */
  region?: string;
  /** Golden source VM to fork on create(). Falls back to ARKER_SOURCE, then `ubuntu-small`. */
  source?: string;
}
```

## API Reference

### Command Execution

```typescript
// Shell command
const result = await sandbox.runCommand('echo hello');

// Run a script via heredoc
const result = await sandbox.runCommand(`python3 - <<'PY'
print("Hello from Python")
PY`);

// With environment and working directory
const result = await sandbox.runCommand('npm test', {
  cwd: '/app',
  env: { CI: '1' },
});
```

`runCommand` returns `{ stdout, stderr, exitCode, durationMs }`.

### Filesystem Operations

Filesystem operations run as shell commands in the VM and work over arbitrary paths.

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hi');
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');
await sandbox.filesystem.mkdir('/tmp/data');
const entries = await sandbox.filesystem.readdir('/tmp');
const exists = await sandbox.filesystem.exists('/tmp/hello.txt');
await sandbox.filesystem.remove('/tmp/hello.txt');
```

### Sandbox Management

```typescript
const sandbox = await sdk.sandbox.create();
const info = await sandbox.getInfo();      // { id, provider, status, createdAt, ... }
const all = await sdk.sandbox.list();      // VMs visible to the API key
const existing = await sdk.sandbox.getById(sandbox.sandboxId);
await sandbox.destroy();
```

## Features

- ✅ **Command Execution** — full shell, Node.js & Python preinstalled (`ubuntu-small`)
- ✅ **Filesystem Operations** — persistent per-VM filesystem (read/write/list/mkdir/exists/remove)
- ✅ **Fast cold start** — forking the default golden boots a sandbox in well under a second
- ✅ **Automatic retries** — the underlying `@arker-ai/sdk` retries transient failures (HTTP 429/502/503/504 and transient backend errors)

## Limitations

- **Creation is fork-only** — direct VM creation is disabled; `create()` forks a golden source.
- **`getUrl` is not supported** — Arker does not expose per-port URLs; `getUrl` throws. VMs forked with network reachability enabled get a stable per-VM hostname — see the [Arker SDK](https://github.com/ArkerHQ/arker-sdk) fork network options.
- **`getInfo` status** — always reports `running`; idle sandboxes resume automatically on their next command.

## Support

- [Arker](https://arker.ai)
- [Arker SDK](https://github.com/ArkerHQ/arker-sdk)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
