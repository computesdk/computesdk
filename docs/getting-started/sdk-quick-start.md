# TypeScript SDK quickstart

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

Create a sandbox, run a command and destroy it when finished. ComputeSDK handles
routing across providers. Save this example as `hello.mts`.

## Install

Use Node.js 22 or later:

```bash
mkdir compute-hello
cd compute-hello
npm init -y
npm install computesdk
npm install --save-dev tsx typescript @types/node
```

## Set your API key

Create an organization API key in **Settings → API keys** in the
[dashboard](https://platform.computesdk.com), then export it:

```bash
export COMPUTE_API_KEY="your_org_api_key"
```

In PowerShell, use `$env:COMPUTE_API_KEY="your_org_api_key"`. Keep the key in your
server environment, outside browser code and source control. See
[authentication](authentication.md) for details.

## Run

```bash
npx tsx hello.mts
```

Expect `hello` on stdout. The `finally` block attempts cleanup even if command
execution fails. If cleanup fails, destroy the sandbox through the dashboard or
CLI. Closing the Node.js process does not stop billing.

## Choose a provider

To select Modal for this example, replace the create call with:

```typescript
const sandbox = await compute.instances.create({ providerOrder: ['modal'] });
```

This explicit order uses your organization's connected Modal key and bypasses
its saved router. Keep the same command and `finally` cleanup. Omit the override
to use saved routing, including managed compute. See [SDK provider selection](../sdk/README.md#choose-a-provider)
for fallback orders and the current managed-provider selection options.

## Next steps

- [TypeScript SDK overview](../sdk/README.md)
- [Commands, files and create options](../platform/sandboxes.md)
- [Errors, limits and safe retries](../sdk/errors.md)
- [SDK reference](../sdk/reference.md)
- [Routing and billing](../guides/routing.md)

This example requires a release containing the built-in router. For older
versions, see [SDK compatibility](../sdk/reference.md#compatibility).
