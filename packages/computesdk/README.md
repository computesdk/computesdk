<a href="https://www.computesdk.com/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.computesdk.com/share/computesdk-logo-dark.svg">
    <img src="https://www.computesdk.com/share/computesdk-logo-light.svg" alt="ComputeSDK" width="240">
  </picture>
</a>

# ComputeSDK TypeScript SDK

Run agent code, tests, and scripts in isolated sandboxes through one API. Use [Sandbox Router](https://www.computesdk.com/sandbox-router) to choose a provider, set a fallback order, or let ComputeSDK route. Use managed compute or bring your own provider keys.

## Install and run

```bash
npm install computesdk
export COMPUTE_API_KEY="your_org_api_key"
```

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

The router follows your organization's saved routing configuration. Sandboxes keep running and billing until destroyed or their lifetime expires.

## API

- `compute.instances.create(options)` creates a sandbox.
- `compute.instances.getById(id)` reconnects to an existing sandbox.
- `compute.instances.list()` lists running sandboxes.
- `compute.instances.destroy(id)` destroys a sandbox.
- Handles expose `runCommand`, `startProcess`, `filesystem`, `getInfo`, `getUrl` and `destroy`.

`sandbox` remains a compatibility alias for `instances`.

## Documentation

[SDK quickstart](https://docs.computesdk.com/interfaces/sdk/sdk-quick-start) · [Authentication](https://docs.computesdk.com/start-here/authentication) · [Routing and BYOK](https://docs.computesdk.com/guides/routing)

Direct vendor adapters and contributor instructions live in the [GitHub repository](https://github.com/computesdk/computesdk/blob/main/OPEN_SOURCE.md).
