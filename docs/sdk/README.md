# TypeScript SDK

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  const result = await sandbox.runCommand('echo hello');
  console.log(result.stdout);
} finally {
  await sandbox.destroy();
}
```

Run code across sandbox providers with `computesdk`. Create sandboxes, execute
commands and work with files through `compute.instances`. ComputeSDK handles
provider routing and credentials.

```bash
npm install computesdk
export COMPUTE_API_KEY="your_org_api_key"
```

[Run the complete example](../getting-started/sdk-quick-start.md).

## Guides

| Task | Guide |
| --- | --- |
| Create, execute and destroy | [SDK quickstart](../getting-started/sdk-quick-start.md) |
| Set an organization API key | [Authentication](../getting-started/authentication.md) |
| Execute commands and follow output | [Run commands](../guides/commands.md) |
| Read, write and transfer files | [Work with files](../guides/files.md) |
| Start a server and share a URL | [Previews](../guides/previews.md) |
| Reconnect and release compute | [Lifecycle](../guides/lifecycle.md) |
| Choose providers and manage billing | [Routing](../guides/routing.md) |
| Handle limits, errors and uncertain creates | [Errors and retries](errors.md) |
| Browse SDK methods | [SDK reference](reference.md) |

For Actions and organization operations, use the CLI or [REST API](../platform/api-reference.md).
