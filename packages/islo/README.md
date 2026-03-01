# @computesdk/islo

Islo provider for ComputeSDK. Run code and shell commands in Islo sandboxes via Islo's HTTP API.

## Installation

```bash
npm install @computesdk/islo
```

## Setup

Install and authenticate with Islo CLI (recommended):

```bash
curl -fsSL https://islo.dev/install.sh | bash
islo login
```

Set API URL:

```bash
export ISLO_API_URL=https://api.islo.dev
```

Optional:

```bash
export ISLO_BEARER_TOKEN=your_islo_bearer_token
export ISLO_PUBLIC_TENANT_ID=tenant_public_id
export ISLO_PUBLIC_USER_ID=user_public_id
export ISLO_IMAGE=docker.io/library/python:3.12-slim
export ISLO_VCPUS=2
export ISLO_MEMORY_MB=2048
export ISLO_DISK_GB=10
```

## Usage

```typescript
import { islo } from '@computesdk/islo';

const compute = islo({
  apiUrl: process.env.ISLO_API_URL,
  bearerToken: process.env.ISLO_BEARER_TOKEN,
});

const sandbox = await compute.sandbox.create({ runtime: 'python' });

const result = await sandbox.runCode('print("hello from islo")', 'python');
console.log(result.output);

await sandbox.destroy();
```

## Configuration

```typescript
interface IsloConfig {
  apiUrl?: string;
  bearerToken?: string; // optional if token is available via ISLO_BEARER_TOKEN, keychain, or auth file
  authFilePath?: string; // optional override for auth file path
  tenantPublicId?: string;
  userPublicId?: string;
  image?: string;
  vcpus?: number;
  memoryMb?: number;
  diskGb?: number;
  timeout?: number;
  runtime?: 'node' | 'python';
  publicHost?: string;
}
```

## Notes

- `sandboxId` is the Islo sandbox name.
- Command execution uses Islo's SSE streaming endpoint (`/exec/stream`).
- If `bearerToken`/`ISLO_BEARER_TOKEN` is not set, the provider tries:
  1. Islo auth file paths (`ISLO_AUTH_FILE`, `~/.islo/auth.json`, `~/.config/islo/auth.json`)
  2. OS keychain entry used by `islo login` (`islo.dev.cli` / `tokens`)
- To force file-based token storage in Islo CLI, use `ISLO_TOKEN_STORAGE=file` before `islo login`.
- Filesystem methods are not implemented in this provider.
