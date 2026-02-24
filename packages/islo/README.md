# @computesdk/islo

Islo provider for ComputeSDK. Run code and shell commands in Islo sandboxes via Islo's HTTP API.

## Installation

```bash
npm install @computesdk/islo
```

## Setup

Set required environment variables:

```bash
export ISLO_API_URL=https://api.islo.dev
export ISLO_BEARER_TOKEN=your_islo_bearer_token
```

Optional:

```bash
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
  bearerToken?: string;
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
- Filesystem methods are not implemented in this provider.
