# Platform SDK reference

The public package is `@computesdk/platform`. Use it alongside `computesdk` for the common instance interface.

## Hosted provider

```typescript
import { compute } from 'computesdk';
import { platform } from '@computesdk/platform';
import type { PlatformConfig, PlatformCreateOptions } from '@computesdk/platform';

const config: PlatformConfig = {
  apiKey: process.env.COMPUTE_API_KEY,
  defaults: { size: 'small' },
};
const sdk = compute({ provider: platform(config) });
const options: PlatformCreateOptions = { size: 'small', label: 'example' };
```

| Export or method | Purpose |
| --- | --- |
| `platform(config)` | Create the hosted provider |
| `PlatformConfig` | Key, URL, org, host trust, defaults and fetch override |
| `PlatformCreateOptions` | Platform sizes, price limits, provider order, secrets, label, disk and idempotency key, alongside common create options |
| `PlatformSize` | `small`, `medium`, `large`, `xlarge`, `2xlarge`, `3xlarge` |
| `sdk.instances.create(options)` | Create a sandbox |
| `sdk.instances.getById(id)` | Reconnect to an existing sandbox |
| `sdk.instances.list()` | List running sandboxes |
| `sdk.instances.destroy(id)` | Destroy a sandbox |
| `sandbox.runCommand(command, options?)` | Buffered, streaming or background execution |
| `sandbox.filesystem` | File and directory operations |
| `sandbox.getUrl({ port })` | Get a port URL |
| `sandbox.destroy()` | Release the sandbox |

See [hosted sandboxes](../platform/sandboxes.md) for option details and limits. `sandbox` is a deprecated alias for `instances` on the compute object; the instance handle is still commonly called a sandbox.

## Lower-level HTTP client

`PlatformClient` provides `get`, `post`, `put`, `patch`, `del`, streaming and download helpers. It is an HTTP transport, not a generated resource SDK. Its generic response types are supplied by the caller and do not validate JSON at runtime.

```typescript
import { PlatformClient, resolvePlatformAuth } from '@computesdk/platform';

async function readIdentity() {
  const auth = await resolvePlatformAuth({ apiKey: process.env.COMPUTE_API_KEY });
  const client = new PlatformClient(auth);
  return client.get<unknown>('/api/v1/me');
}
```

The package also exports `PlatformApiError`, `PlatformClientError`, auth/error types, SSE helpers and sandbox wire types. Wire types such as `CommandResult` and `FileEntry` differ from the normalized core SDK types: use the types that match the interface you call.

The [REST reference](../platform/api-reference.md) documents routes. Availability of a REST route does not imply a corresponding provider method. Provider templates are not supported by the hosted provider.
