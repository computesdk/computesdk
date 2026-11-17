# ComputeSDK

One router for sandboxes and Actions. Run code across sandbox providers through the CLI, TypeScript SDK or API. Use ComputeSDK-managed compute or bring your own provider keys.

## Install

```bash
npm install computesdk
```

## Run code

Set your organization API key, or sign in using the separately installed ComputeSDK CLI:

```bash
export COMPUTE_API_KEY="your_org_api_key"
# Alternatively: compute login
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

No factory call or provider adapter is needed. The router follows your organization's saved routing configuration. Sandboxes keep running and billing until destroyed or their lifetime expires.

Saved CLI sessions are read and refreshed automatically. The SDK does not install the CLI or open browser sign-in; set `COMPUTE_API_KEY` for applications and CI.

## API

- `compute.instances.create(options)` creates a sandbox.
- `compute.instances.getById(id)` reconnects to an existing sandbox.
- `compute.instances.list()` lists running sandboxes.
- `compute.instances.destroy(id)` destroys a sandbox.
- Handles expose `runCommand`, `startProcess`, `filesystem`, `getInfo`, `getUrl` and `destroy`.

`sandbox` remains a compatibility alias for `instances`.

## Explicit configuration

Existing provider and multi-provider configuration continues to work. An explicitly configured provider calls that provider directly; it does not fall back to the ComputeSDK router.

For custom router configuration, `platform`, `PlatformConfig` and `PlatformCreateOptions` are exported by `computesdk`. `@computesdk/platform` remains a compatibility package. [Configuration and compatibility](https://docs.computesdk.com/typescript-sdk/reference) cover both paths.

## Documentation

[Quickstart](https://docs.computesdk.com/start-here/sdk-quick-start) · [Authentication](https://docs.computesdk.com/start-here/authentication) · [Routing and BYOK](https://docs.computesdk.com/guides/routing)

Direct vendor adapters and contributor instructions live in the [GitHub repository](https://github.com/computesdk/computesdk/blob/main/OPEN_SOURCE.md).
