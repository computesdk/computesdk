---
description: Run code, work with files and preview applications through ComputeSDK sandboxes.
---

# Sandboxes

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Run agent code, tests and scripts in isolated sandboxes. ComputeSDK handles
provider setup and routing. Start with the [TypeScript SDK](../getting-started/sdk-quick-start.md)
or [CLI quickstart](../getting-started/quick-start.md).

## Build with sandboxes

| Task | Guide |
| --- | --- |
| Execute code, tests and long-running jobs | [Run commands](../guides/commands.md) |
| Read, write, upload and download | [Work with files](../guides/files.md) |
| Bring a local application | [Project sync](../cli/project-sync.md) |
| Start a server and share its URL | [Application previews](../guides/previews.md) |
| Reconnect, manage lifetime and clean up | [Sandbox lifecycle](../guides/lifecycle.md) |
| Choose a provider or fallback order | [Routing](../guides/routing.md) |

## Choose your compute

Let ComputeSDK route, pick a provider or set preferences. See the
[provider catalog](../providers/README.md) for available integrations and
[rates](../guides/billing.md) for managed compute. Provider capabilities and
available sizes vary. Placement happens when a sandbox is created; a running
sandbox stays on its provider.

Use the [SDK reference](../sdk/reference.md) for create options and methods,
[errors and limits](../sdk/errors.md) for safe retries, or the
[REST reference](api-reference.md#sandboxes) for HTTP fields and responses.
