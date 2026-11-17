# TypeScript SDK quickstart

Create a hosted sandbox from a Node.js application using `computesdk`. The platform handles placement; your application does not need provider-specific packages or vendor credentials.

The examples below require a release of `computesdk` containing the built-in router. For `computesdk@4.1.18` and earlier, see [SDK compatibility](../sdk/reference.md#compatibility).

## 1. Set up a project

Use a supported Node.js release (Node.js 22 or later for this example):

```bash
mkdir compute-hello
cd compute-hello
npm init -y
npm install computesdk
npm install --save-dev tsx typescript @types/node
```

## 2. Authenticate

Sign in to the [platform dashboard](https://platform.computesdk.com), select your organization, and create an API key in **Settings → API keys**. Export the key in the terminal that will run your application:

```bash
export COMPUTE_API_KEY="your_org_api_key"
```

In PowerShell, use `$env:COMPUTE_API_KEY="your_org_api_key"`. An org API key acts on its own organization. Keep it in your server environment, not browser code or source control.

Make sure the organization has managed compute credit or a configured BYOK route. See [routing and BYOK](../guides/routing.md). See [authentication](authentication.md) for API key setup.

## 3. Create, execute and clean up

Save this as `hello.ts`:

```typescript
import { compute } from 'computesdk';

async function main() {
  const sandbox = await compute.instances.create({ size: 'small' });
  try {
    const result = await sandbox.runCommand('echo hello');
    console.log(result.stdout);
    if (result.exitCode !== 0) {
      throw new Error(`Command failed (${result.exitCode}): ${result.stderr}`);
    }
  } finally {
    await sandbox.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

Run it:

```bash
npx tsx hello.ts
```

Expect `hello` on stdout. The `finally` block attempts cleanup even if command execution fails. If cleanup fails, find the sandbox in the dashboard and destroy it there or through the CLI. Closing the Node.js process does not stop billing.

## Next steps

- [TypeScript SDK overview](../sdk/README.md)
- [Commands, files and create options](../platform/sandboxes.md)
- [Errors, limits and safe retries](../sdk/errors.md)
- [SDK exports and HTTP client](../sdk/reference.md)

New examples use `instances`; `sandbox` remains a compatibility alias. The platform API and CLI still call these resources sandboxes.
