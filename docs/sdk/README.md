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

## Choose a provider

With no routing override, `compute.instances.create()` follows your
organization's saved Sandboxes router. To select a specific provider for one
create, pass a single-entry `providerOrder`:

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({
  providerOrder: ['modal'],
});
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Named providers in `providerOrder` use your organization's connected provider
keys. Connect a Modal key before running this example. An explicit order
bypasses saved routing for this create; it does not change your organization's
settings. A single provider means no fallback to another provider.

For an ordered fallback, use `providerOrder: ['modal', 'e2b']`. ComputeSDK tries
the eligible providers in that order. See [routing and safe overrides](../guides/routing.md#sdk-and-rest-overrides)
and [errors and retries](errors.md) for uncertain create outcomes.

### Choose managed compute

For managed compute, leave out `providerOrder` both per call and in client
`defaults`. Configure your organization's Sandboxes router under
**Settings → Sandboxes → Managed accounts** in the
[dashboard](https://platform.computesdk.com). Choose the recommended order,
the cheapest available route for the requested size, or your own provider
order. See [define routing rules](../guides/routing.md#define-routing-rules-in-the-platform)
for setup. Saved rules apply to future creates that follow the router.

The current SDK does not expose a per-create managed-provider pin. The CLI's
`compute new modal --managed` and the [REST routing fields](../platform/api-reference.md#sandboxes)
(`only` with `byok: "off"`) provide request-level managed-provider selection. Use the [provider catalog](../providers/README.md)
for available router IDs and [routing](../guides/routing.md) for account modes.

## Guides

| Task | Guide |
| --- | --- |
| Create, execute and destroy | [SDK quickstart](../getting-started/sdk-quick-start.md) |
| Set an organization API key | [Authentication](../getting-started/authentication.md) |
| Execute commands and follow output | [Run commands](../guides/commands.md) |
| Read, write and transfer files | [Work with files](../guides/files.md) |
| Start a server and share a URL | [Previews](../guides/previews.md) |
| Reconnect and release compute | [Lifecycle](../guides/lifecycle.md) |
| Choose a provider or fallback order | [Provider selection](#choose-a-provider) |
| Configure routing and accounts | [Routing](../guides/routing.md) |
| Handle limits, errors and uncertain creates | [Errors and retries](errors.md) |
| Browse SDK methods | [SDK reference](reference.md) |

For Actions and organization operations, use the CLI or [REST API](../platform/api-reference.md).
