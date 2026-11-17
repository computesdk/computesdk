# TypeScript SDK reference

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ size: 'small' });
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Install `computesdk`. The exported `compute` singleton uses the ComputeSDK router by default; no factory call or adapter package is needed. Set `COMPUTE_API_KEY` to authenticate.

## Methods

| Export or method | Purpose |
| --- | --- |
| `compute.instances.create(options)` | Create a sandbox |
| `compute.instances.getById(id)` | Reconnect to an existing sandbox |
| `compute.instances.list()` | List running sandboxes |
| `compute.instances.destroy(id)` | Destroy a sandbox |
| `sandbox.runCommand(command, options?)` | Buffered, streaming or background execution |
| `sandbox.filesystem` | File and directory operations |
| `sandbox.getUrl({ port })` | Get a port URL |
| `sandbox.destroy()` | Release the sandbox |

See [hosted sandboxes](../platform/sandboxes.md) for option details and limits. `sandbox` is a deprecated alias for `instances` on the compute object; the instance handle is still commonly called a sandbox.

For Actions and organization resources, use the [REST API](../platform/api-reference.md).
See [create options, commands and files](../platform/sandboxes.md) for detailed
sandbox examples.

## Compatibility

`computesdk@4.1.18` and earlier do not include the default router. Upgrade to a
release containing built-in routing to use the examples in these docs.

Explicit provider and multi-provider configurations continue to work. An
invalid explicit configuration still fails; it does not silently use the router.
See the [GitHub adapter documentation](https://github.com/computesdk/computesdk/blob/main/OPEN_SOURCE.md)
for existing direct provider integrations.
