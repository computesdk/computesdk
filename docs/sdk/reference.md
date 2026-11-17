# TypeScript SDK reference

Install `computesdk`. The exported `compute` singleton uses the ComputeSDK router by default; no factory call or adapter package is needed. Set `COMPUTE_API_KEY` to authenticate.

## Default router

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ size: 'small' });
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

## Advanced configuration

For custom endpoints, organization overrides or create defaults, use the bundled `platform` factory with `compute.setConfig`. Explicit direct provider configuration continues to bypass the router.

```typescript
import { compute, platform } from 'computesdk';
import type { PlatformConfig, PlatformCreateOptions } from 'computesdk';

const config: PlatformConfig = {
  apiKey: process.env.COMPUTE_API_KEY,
  defaults: { size: 'small' },
};
compute.setConfig({ provider: platform(config) });
const options: PlatformCreateOptions = { size: 'small', label: 'example' };
```

| Export or method | Purpose |
| --- | --- |
| `platform(config)` | Create the hosted provider |
| `PlatformConfig` | Key, URL, org, host trust, defaults and fetch override |
| `PlatformCreateOptions` | Platform sizes, price limits, provider order, secrets, label, disk and idempotency key, alongside common create options |
| `PlatformSize` | `small`, `medium`, `large`, `xlarge`, `2xlarge`, `3xlarge` |
| `compute.instances.create(options)` | Create a sandbox |
| `compute.instances.getById(id)` | Reconnect to an existing sandbox |
| `compute.instances.list()` | List running sandboxes |
| `compute.instances.destroy(id)` | Destroy a sandbox |
| `sandbox.runCommand(command, options?)` | Buffered, streaming or background execution |
| `sandbox.filesystem` | File and directory operations |
| `sandbox.getUrl({ port })` | Get a port URL |
| `sandbox.destroy()` | Release the sandbox |

See [hosted sandboxes](../platform/sandboxes.md) for option details and limits. `sandbox` is a deprecated alias for `instances` on the compute object; the instance handle is still commonly called a sandbox.

## Lower-level HTTP client

`PlatformClient` provides `get`, `post`, `put`, `patch`, `del`, streaming and download helpers. It is an HTTP transport, not a generated resource SDK. Its generic response types are supplied by the caller and do not validate JSON at runtime.

```typescript
import { PlatformClient, resolvePlatformAuth } from 'computesdk';

async function readIdentity() {
  const auth = await resolvePlatformAuth({ apiKey: process.env.COMPUTE_API_KEY });
  const client = new PlatformClient(auth);
  return client.get<unknown>('/api/v1/me');
}
```

The package also exports `PlatformApiError`, `PlatformClientError`, auth/error types, SSE helpers and sandbox wire types. Wire types such as `PlatformCommandResult` and `PlatformFileEntry` differ from the normalized core SDK types: use the types that match the interface you call.

The [REST reference](../platform/api-reference.md) documents routes. Availability of a REST route does not imply a corresponding provider method. Provider templates are not supported by the hosted provider.


## Compatibility

`computesdk@4.1.18` and earlier do not include the default router. Upgrade to a release containing built-in routing, or continue installing `computesdk` and `@computesdk/platform` and explicitly configuring the adapter:

```typescript
import { compute } from 'computesdk';
import { platform } from '@computesdk/platform';

compute.setConfig({ provider: platform({}) });
```

`@computesdk/platform` remains a compatibility export for the bundled router and HTTP client. Its original `CommandResult` and `FileEntry` wire type names remain available. Existing `compute({ provider })`, `compute.setConfig({ provider })` and multi-provider configurations continue to use the explicitly configured providers. An invalid explicit configuration still fails; it does not silently use the router.
