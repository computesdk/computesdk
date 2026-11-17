# Sandbox providers

Use one CLI, TypeScript SDK or MCP connection across these ComputeSDK router
integrations. Start with managed compute, choose a provider, or connect your
own account. Your organization's available routes and current capacity
determine which integrations you can run.

[Compare providers](https://www.computesdk.com/providers/sandboxes) using public
benchmarks and reliability results. Provider pages, such as
[Modal](https://www.computesdk.com/providers/modal#sandboxes), link comparisons
and a starter where available.

## Supported providers

The catalog covers the router's registered sandbox integrations. The command
column uses a verified ComputeSDK npm starter where one is published; otherwise,
[install the CLI](../getting-started/installation.md#cli) and use `compute new`.
All commands create remote sandboxes and can incur compute charges.

<!-- Registry reviewed 2026-11-17: benchmarks-platform@67cf00fa,
     lib/providers/{sandbox-builders,registry-extra,endpoint-providers}.ts.
     npm starters verified against package repository metadata. -->

| Provider | Router ID | Start |
| --- | --- | --- |
| Agent37 | `agent37` | `npm create agent37@latest` |
| Archil | `archil` | `npm create archil@latest` |
| Arker | `arker` | `npm create arker@latest` |
| AWS EC2 | `aws-ec2` | `compute new aws-ec2` |
| Beam | `beam` | `npm create beam@latest` |
| Blaxel | `blaxel` | `npm create blaxel@latest` |
| Buddy | `buddy` | `npm create buddy@latest` |
| Cloudflare | `cloudflare` | `npm create cloudflare-sandbox@latest` |
| CodeSandbox | `codesandbox` | `npm create codesandbox@latest` |
| ComputeSDK managed compute | `computesdk` | `compute new computesdk` |
| CreateOS | `createos-sandbox` | `compute new createos-sandbox` |
| Daytona | `daytona` | `npm create daytona@latest` |
| E2B | `e2b` | `npm create e2b@latest` |
| Freestyle | `freestyle` | `npm create freestyle@latest` |
| GiveMeANode | `givemeanode` | `compute new givemeanode` |
| Google Cloud Run | `cloud-run` | `compute new cloud-run` |
| GravixLayer | `gravixlayer` | `npm create gravixlayer@latest` |
| Isorun | `isorun` | `npm create isorun@latest` |
| Leap0 | `leap0` | `compute new leap0` |
| Lightning | `lightning` | `compute new lightning` |
| Luxor (Tenki) | `tenki` | `npm create tenki@latest` |
| Microsandbox | `microsandbox` | `npm create microsandbox@latest` |
| MIOSA | `miosa` | `npm create miosa@latest` |
| Modal | `modal` | `npm create modal@latest` |
| Mosaic | `mosaic` | `npm create mosaic@latest` |
| Namespace | `namespace` | `npm create namespace@latest` |
| Novita | `novita` | `npm create novita@latest` |
| OpenComputer | `opencomputer` | `npm create opencomputer@latest` |
| Promigence | `promigence` | `npm create promigence@latest` |
| Railway | `railway` | `compute new railway` |
| Run.cloud | `run-cloud` | `compute new run-cloud` |
| Runloop | `runloop` | `npm create runloop@latest` |
| Sail | `sail` | `npm create sail@latest` |
| Sandbox0 | `sandbox0` | `compute new sandbox0` |
| Sprites | `sprites` | `npm create sprites@latest` |
| Superserve | `superserve` | `npm create superserve@latest` |
| Tensorlake | `tensorlake` | `npm create tensorlake@latest` |
| Uno | `uno` | `compute new uno` |
| Upstash | `upstash` | `npm create upstash@latest` |
| Vercel | `vercel` | `npm create vercel@latest` |

For CLI usage, every row also accepts `compute new <router-id>`. Leave out the
ID with `compute new` to let ComputeSDK choose. Luxor retains the router ID
`tenki`. The ComputeSDK-managed row represents ComputeSDK's own capacity.

## Start with a provider

```bash
npm create modal@latest
compute exec echo hello
compute destroy
```

The starter guides setup and creates a sandbox pinned to that provider. It
creates remote compute rather than scaffolding a local application. Starters
are ComputeSDK integrations, not official vendor packages. See
[the provider quickstart](getting-started.md) for selection and cleanup.

Use the commands in this table rather than guessing npm names. For example,
ComputeSDK's Cloudflare starter is `npm create cloudflare-sandbox@latest`.

## Check availability

```bash
compute sandboxes options
compute sandboxes route --provider modal --size small
```

`options` shows your available managed capacity, sizes and rates, and connected
provider readiness. `route` previews placement without creating a sandbox.
Being listed in the catalog or benchmarks does not guarantee capacity or grant
access to a provider account. See [routing](../guides/routing.md).

## Capabilities

Sizes, images, snapshots, reconnect behavior and public URLs vary by provider.
Check options for your request and handle an unsupported capability rather
than assuming all integrations behave identically.

Actions uses the same router with workflow-specific eligibility. Inspect its
available providers with `compute actions providers`; a sandbox integration
does not imply support for every workflow feature. See [Actions](../platform/actions.md).

For direct vendor adapters, custom providers and source development, use the
[GitHub repository](https://github.com/computesdk/computesdk/tree/main/packages).
