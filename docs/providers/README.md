# Sandbox providers

Choose a provider through the ComputeSDK router. Use the CLI, TypeScript SDK or MCP to create and control sandboxes without integrating a different vendor SDK for each provider.

[Compare providers](https://www.computesdk.com/providers/sandboxes) using public benchmarks and reliability results. A provider's sandbox page, such as [Modal](https://www.computesdk.com/providers/modal/sandboxes), includes a starter command where available.

## Start with a provider

These published starters create sandboxes through ComputeSDK:

| Provider | Command |
| --- | --- |
| Modal | `npm create modal@latest` |
| E2B | `npm create e2b@latest` |
| Daytona | `npm create daytona@latest` |
| Vercel | `npm create vercel@latest` |
| Beam | `npm create beam@latest` |
| Superserve | `npm create superserve@latest` |

These are examples, not the full availability list. See [Start on a provider](getting-started.md) for authentication, placement and cleanup. The starters are independent ComputeSDK integrations, not official vendor packages. They create remote sandboxes rather than scaffolding local applications.

## See what your organization can run

```bash
compute sandboxes options
compute sandboxes route --provider modal --size small
```

`options` shows managed capacity, offered sizes/rates and BYOK readiness for your organization. `route` previews placement without creating a sandbox. Availability depends on your organization, connected keys and current capacity; a benchmark listing or published npm starter does not grant access.

With the CLI installed, select a provider directly:

```bash
compute new modal
```

Or let your saved router choose:

```bash
compute new
```

A provider choice narrows the router; it does not switch to a direct vendor integration. Placement happens when the sandbox is created. A running sandbox stays on that provider.

## Managed compute or BYOK

Use ComputeSDK-managed accounts and credits, or connect your own provider keys to your organization. Both use the same router and sandbox interface. [Routing and BYOK](../guides/routing.md) explains account modes, fallback and billing.

Sizes, images, snapshots, command execution and port URLs vary by provider. Check the available options for your request rather than assuming every provider offers the same capabilities.

## Direct vendor integrations

These docs cover providers used through ComputeSDK. For adapters that call vendor APIs directly, custom providers and source development, see the [GitHub repository](https://github.com/computesdk/computesdk/tree/main/packages).
