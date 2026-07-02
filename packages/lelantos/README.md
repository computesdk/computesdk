# @computesdk/lelantos

Lelantos provider for ComputeSDK — execute code in secure, EU-native [Firecracker](https://firecracker-microvm.github.io/) microVM sandboxes with full filesystem and terminal support.

[Lelantos](https://lelantos.ai/) is an E2B-API-compatible sandbox platform running on Hetzner bare-metal in the EU. Because the wire protocol is E2B-compatible, this provider wraps the same `e2b` npm SDK — but points it at a Lelantos control plane via `domain` / `apiUrl` and threads those options through **every** SDK call (create, connect, list, kill, snapshot, template), so lifecycle operations stay on Lelantos rather than falling back to `api.e2b.app`.

## Installation

```bash
npm install @computesdk/lelantos
```

## Setup

1. Get your Lelantos API key from [lelantos.ai](https://lelantos.ai/)
2. Set the environment variable:

```bash
export LELANTOS_API_KEY=lel_your_api_key_here
```

Lelantos issues `lel_…` keys. The provider also accepts the `e2b_…` form of a Lelantos key and does not enforce a key prefix.

## Quick Start

Configure `compute` with the Lelantos provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { lelantos } from '@computesdk/lelantos';

compute.setConfig({
  provider: lelantos({ apiKey: process.env.LELANTOS_API_KEY }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`python3 - <<'PY'
import platform
print("Hello from a Lelantos microVM")
print(platform.platform())
PY`);

console.log(result.stdout);
await sandbox.destroy();
```

Alternatively, call the provider factory directly when you only need one provider:

```typescript
import { lelantos } from '@computesdk/lelantos';

const sdk = lelantos({ apiKey: process.env.LELANTOS_API_KEY });
const sandbox = await sdk.sandbox.create();
```

## Configuration

### Environment Variables

```bash
export LELANTOS_API_KEY=lel_your_api_key_here
# Optional — override the control-plane + sandbox domain (defaults to lelantos.ai)
export LELANTOS_DOMAIN=lelantos.ai
# Optional — explicit control-plane URL (overrides the domain-derived URL)
export LELANTOS_API_URL=https://api.lelantos.ai
```

The provider resolves credentials with the following fallback order so it is a drop-in for E2B-shaped configs:

- API key: `config.apiKey` → `LELANTOS_API_KEY` → `E2B_API_KEY`
- Domain: `config.domain` → `LELANTOS_DOMAIN` → `E2B_DOMAIN`
- API URL: `config.apiUrl` → `LELANTOS_API_URL` → `E2B_API_URL`

### Configuration Options

```typescript
interface LelantosConfig {
  /** Lelantos API key (lel_… or e2b_… form). Falls back to LELANTOS_API_KEY then E2B_API_KEY. */
  apiKey?: string;
  /** Control-plane + sandbox domain, e.g. 'lelantos.ai'. Falls back to LELANTOS_DOMAIN then E2B_DOMAIN. */
  domain?: string;
  /** Explicit control-plane URL override. Falls back to LELANTOS_API_URL then E2B_API_URL. */
  apiUrl?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

Pointing the provider at a self-hosted or staging Lelantos slot is just a matter of setting `domain` (and optionally `apiUrl`):

```typescript
const provider = lelantos({
  apiKey: process.env.LELANTOS_API_KEY,
  domain: 'staging.lelantos.ai',
});
```

## Features

- ✅ **EU-native microVMs** — Firecracker isolation on Hetzner bare-metal in the EU
- ✅ **Command Execution** — Run shell commands in the sandbox, with real exit codes surfaced (non-zero exits are returned, not masked)
- ✅ **Filesystem Operations** — Read, write, list, mkdir, exists, remove
- ✅ **Per-port Preview URLs** — `getUrl({ port })` returns `https://{port}-{sandboxId}.{domain}`
- ✅ **Snapshots & Templates** — Snapshot a running sandbox; list/delete templates
- ✅ **Domain / apiUrl threaded everywhere** — control-plane calls always target your Lelantos slot

## API Reference

### Command Execution

```typescript
// Run Python via heredoc
const result = await sandbox.runCommand(`python3 - <<'PY'
import json
print(json.dumps({"message": "Hello from Python"}))
PY`);

// List files
const ls = await sandbox.runCommand('ls -la');

// A non-zero exit is returned (not thrown) with the real exit code + stderr
const failed = await sandbox.runCommand('exit 3');
console.log(failed.exitCode); // 3
```

### Filesystem Operations

```typescript
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');
await sandbox.filesystem.mkdir('/tmp/data');
const files = await sandbox.filesystem.readdir('/tmp');
const exists = await sandbox.filesystem.exists('/tmp/hello.py');
await sandbox.filesystem.remove('/tmp/hello.py');
```

### Preview URLs

```typescript
// Expose a server running on port 3000 inside the sandbox
const url = await sandbox.getUrl({ port: 3000 });
// => https://3000-<sandboxId>.lelantos.ai
```

### Sandbox Management

```typescript
const info = await sandbox.getInfo();
console.log(info.id, info.status, info.createdAt);

await sandbox.destroy();
```

## Error Handling

```typescript
import { lelantos } from '@computesdk/lelantos';

try {
  const compute = lelantos({ apiKey: process.env.LELANTOS_API_KEY });
  const sandbox = await compute.sandbox.create();
} catch (error) {
  if (error.message.includes('Missing Lelantos API key')) {
    console.error('Set LELANTOS_API_KEY environment variable');
  } else if (error.message.includes('authentication failed')) {
    console.error('Check your Lelantos API key');
  } else if (error.message.includes('quota exceeded')) {
    console.error('Lelantos usage limits reached');
  }
}
```

## Best Practices

1. **Resource Management** — Always destroy sandboxes when done to free resources.
2. **Error Handling** — Use try/catch around create/connect calls.
3. **Timeouts** — Set an appropriate `timeout` for long-running tasks.
4. **API Key Security** — Never commit API keys to version control.

## Limitations

- **Template creation** — Build templates via the E2B-compatible template build protocol / CLI, or snapshot a running sandbox with `snapshot.create()`. Direct `template.create()` is intentionally unsupported.
- **Region** — Sandboxes run in the EU (single-region today).

## Roadmap

Lelantos also offers **browser sandboxes** (CDP-controllable Firecracker browser microVMs). A follow-up release will add a Lelantos-only `browser` extension namespace to this provider. This initial package is intentionally compute-focused (portable `sandbox` / `snapshot` / `template` surface only) to keep it a clean drop-in alongside the other ComputeSDK providers.

## Support

- [Lelantos](https://lelantos.ai/)
- [ComputeSDK Issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
