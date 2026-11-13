# ComputeSDK Cloudflare Direct Mode Example

This example uses `@computesdk/cloudflare` inside a Cloudflare Worker and calls the sandbox demo Worker's `Sandbox` Durable Object directly.

Deploy the [sandbox demo Worker](https://github.com/cloudflare/containers-demos/tree/main/sandbox) first. Its Worker name must match the `script_name` in `wrangler.jsonc`:

```jsonc
{
  "name": "SANDBOX",
  "class_name": "Sandbox",
  "script_name": "sandbox"
}
```

The example passes that binding to the provider:

```typescript
const compute = cloudflare({
  sandboxBinding: env.SANDBOX,
})
```

## Deploy

Install dependencies from the repository root, then deploy the example:

```bash
corepack pnpm install
corepack pnpm --filter @computesdk/example-cloudflare-direct deploy
```

The Worker creates a sandbox, executes a command, writes and reads a file under `/tmp`, and destroys the sandbox.
