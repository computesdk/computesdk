# @computesdk/quilt

Quilt provider for ComputeSDK.

This package maps ComputeSDK's sandbox interface onto Quilt's tenant-scoped container API. It supports container lifecycle, synchronous command execution, published HTTP/WebSocket services, shell-backed filesystem operations, and Quilt snapshots.

## Features

- Create, inspect, list, and destroy Quilt containers
- Run shell commands through Quilt's synchronous `/exec` API
- Expose HTTP or WebSocket URLs through Quilt published services
- Read and write files inside the container filesystem through exec
- Create, list, and delete Quilt snapshots

## Installation

```bash
npm install computesdk @computesdk/quilt
```

## Configuration

The provider accepts config directly and falls back to environment variables.

```typescript
import { quilt } from '@computesdk/quilt';

const provider = quilt({
  baseUrl: process.env.QUILT_BASE_URL,
  apiKey: process.env.QUILT_API_KEY,
  tenantId: process.env.QUILT_TENANT_ID,
});
```

Supported config fields:

- `baseUrl` or `QUILT_BASE_URL`: Quilt backend base URL
- `apiKey` or `QUILT_API_KEY`: Quilt API key
- `accessToken` or `QUILT_ACCESS_TOKEN`: Bearer token for JWT-backed deployments
- `tenantId` or `QUILT_TENANT_ID`: required for snapshot operations
- `image` or `QUILT_IMAGE`: default container image, defaults to `prod`
- `timeout` or `QUILT_TIMEOUT_MS`: default provider timeout in milliseconds
- `publishedServiceAuthMode` or `QUILT_PUBLISHED_SERVICE_AUTH_MODE`: `service_token` or `public`
- `publishedServiceTtlSecs` or `QUILT_PUBLISHED_SERVICE_TTL_SECS`: optional published-service TTL
- `pollIntervalMs` or `QUILT_POLL_INTERVAL_MS`: async operation polling interval

At least one of `apiKey` or `accessToken` must be configured.

## Usage

```typescript
import { compute } from 'computesdk';
import { quilt } from '@computesdk/quilt';

compute.setConfig({
  provider: quilt({
    baseUrl: process.env.QUILT_BASE_URL,
    apiKey: process.env.QUILT_API_KEY,
    tenantId: process.env.QUILT_TENANT_ID,
  }),
});

const sandbox = await compute.sandbox.create({
  name: 'computesdk-demo',
  envs: {
    APP_ENV: 'dev',
  },
});

const result = await sandbox.runCommand('echo "hello from Quilt"');
console.log(result.stdout);

const url = await sandbox.getUrl({ port: 3000 });
console.log(url);

await sandbox.destroy();
```

## Snapshot Support

Snapshot operations require `tenantId` because Quilt validates `X-Tenant-Id` on snapshot routes.

```typescript
const snapshot = await provider.snapshot?.create(sandbox.sandboxId, {
  name: 'baseline',
  metadata: { branch: 'main' },
});
```

## Limitations

- `getUrl()` maps to Quilt published services, so it is HTTP/WebSocket only
- Filesystem operations are implemented over shell exec for portability across Quilt containers
- `template` operations are not exposed because Quilt's closest equivalents are image references and snapshots, which map differently

