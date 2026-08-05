# @computesdk/mosaic

Mosaic provider for ComputeSDK. Mosaic provides Firecracker-based sandbox environments with command execution and lifecycle management.

## Installation

```bash
npm install computesdk @computesdk/mosaic
```

## Quick start

```typescript
import { compute } from 'computesdk';
import { mosaic } from '@computesdk/mosaic';

compute.setConfig({
  provider: mosaic({
    baseUrl: process.env.MOSAIC_API_URL,
    apiKey: process.env.MOSAIC_API_TOKEN,
  }),
});

const sandbox = await compute.sandbox.create({
  templateId: 'node-20',
  memoryMb: 4096,
  vcpus: 2,
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.destroy();
```

The provider also reads `MOSAIC_API_URL` and `MOSAIC_API_TOKEN` when those values are omitted from the configuration. `baseUrl` should point to a Mosaic API deployment, and `apiKey` is sent as a bearer token.

## Configuration

```typescript
interface MosaicConfig {
  baseUrl?: string;
  apiKey?: string;
  template?: string;
  memoryMb?: number;
  vcpu?: number;
  requestTimeoutMs?: number;
}
```

Per-sandbox `templateId`, `runtime`, `memoryMb`, `memoryMiB`, `vcpus`, and `cpus` options override the provider defaults.

## Supported operations

| Method | Supported | Notes |
|---|---|---|
| `create` | ✅ | Creates a Mosaic sandbox with template and resource overrides. |
| `getById` | ✅ | Returns `null` when the sandbox is not found. |
| `list` | ✅ | Lists sandboxes visible to the API token. |
| `destroy` | ✅ | Idempotent for missing sandboxes. |
| `runCommand` | ✅ | Supports working directory, environment, timeout, and background execution. |
| `getInfo` | ✅ | Returns lifecycle state and resource metadata. |
| `getUrl` | ❌ | Preview URL support is not currently implemented. |
| `filesystem` | ❌ | Use `runCommand` for file operations. |
