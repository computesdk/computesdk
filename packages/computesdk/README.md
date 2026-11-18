# ComputeSDK

One router for sandboxes and Actions. Run code across sandbox providers through the CLI, TypeScript SDK or API. Use ComputeSDK-managed compute or bring your own provider keys.

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({ size: 'small' });
try {
  const result = await sandbox.runCommand('echo hello');
  console.log(result.stdout);
} finally {
  await sandbox.destroy();
}
```

## Install and run

```bash
npm install computesdk
export COMPUTE_API_KEY="your_org_api_key"
```

No factory call or provider adapter is needed. The router follows your organization's saved routing configuration. Sandboxes keep running and billing until destroyed or their lifetime expires.

## API

- `compute.instances.create(options)` creates a sandbox.
- `compute.instances.getById(id)` reconnects to an existing sandbox.
- `compute.instances.list()` lists running sandboxes.
- `compute.instances.destroy(id)` destroys a sandbox.
- Handles expose `runCommand`, `startProcess`, `filesystem`, `getInfo`, `getUrl` and `destroy`.

`sandbox` remains a compatibility alias for `instances`.

## Documentation

[Quickstart](https://docs.computesdk.com/start-here/sdk-quick-start) · [Authentication](https://docs.computesdk.com/start-here/authentication) · [Routing and BYOK](https://docs.computesdk.com/guides/routing)

Direct vendor adapters and contributor instructions live in the [GitHub repository](https://github.com/computesdk/computesdk/blob/main/OPEN_SOURCE.md).
