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

### Start with npm create

These providers have a verified ComputeSDK npm starter. Run the command to
start setup and create a sandbox on that provider.

| Provider | Router ID | Command |
| --- | --- | --- |
| Agent37 | `agent37` | `npm create agent37` |
| Archil | `archil` | `npm create archil` |
| Arker | `arker` | `npm create arker` |
| Beam | `beam` | `npm create beam` |
| Blaxel | `blaxel` | `npm create blaxel` |
| Buddy | `buddy` | `npm create buddy` |
| Cloudflare | `cloudflare` | `npm create cloudflare-sandbox` |
| CodeSandbox | `codesandbox` | `npm create codesandbox` |
| Daytona | `daytona` | `npm create daytona` |
| E2B | `e2b` | `npm create e2b` |
| Freestyle | `freestyle` | `npm create freestyle` |
| GravixLayer | `gravixlayer` | `npm create gravixlayer` |
| Isorun | `isorun` | `npm create isorun` |
| Luxor (Tenki) | `tenki` | `npm create tenki` |
| Microsandbox | `microsandbox` | `npm create microsandbox` |
| MIOSA | `miosa` | `npm create miosa` |
| Modal | `modal` | `npm create modal` |
| Mosaic | `mosaic` | `npm create mosaic` |
| Namespace | `namespace` | `npm create namespace` |
| Novita | `novita` | `npm create novita` |
| OpenComputer | `opencomputer` | `npm create opencomputer` |
| Promigence | `promigence` | `npm create promigence` |
| Runloop | `runloop` | `npm create runloop` |
| Sail | `sail` | `npm create sail` |
| Sprites | `sprites` | `npm create sprites` |
| Superserve | `superserve` | `npm create superserve` |
| Tensorlake | `tensorlake` | `npm create tensorlake` |
| Upstash | `upstash` | `npm create upstash` |
| Vercel | `vercel` | `npm create vercel` |

### Start with compute new

These providers use the CLI directly. [Install the CLI](../getting-started/installation.md#cli),
then run the command for your provider.

| Provider | Router ID | Command |
| --- | --- | --- |
| AWS EC2 | `aws-ec2` | `compute new aws-ec2` |
| ComputeSDK managed compute | `computesdk` | `compute new computesdk` |
| CreateOS | `createos-sandbox` | `compute new createos-sandbox` |
| GiveMeANode | `givemeanode` | `compute new givemeanode` |
| Google Cloud Run | `cloud-run` | `compute new cloud-run` |
| Leap0 | `leap0` | `compute new leap0` |
| Lightning | `lightning` | `compute new lightning` |
| Railway | `railway` | `compute new railway` |
| Run.cloud | `run-cloud` | `compute new run-cloud` |
| Sandbox0 | `sandbox0` | `compute new sandbox0` |
| Uno | `uno` | `compute new uno` |

For CLI usage, every row also accepts `compute new <router-id>`. Leave out the
ID with `compute new` to let ComputeSDK choose. Luxor retains the router ID
`tenki`. The ComputeSDK-managed row represents ComputeSDK's own capacity.

## Start with a provider

```bash
npm create modal
compute exec echo hello
compute destroy
```

The starter guides setup and creates a sandbox pinned to that provider. It
creates remote compute rather than scaffolding a local application. Starters
are ComputeSDK integrations, not official vendor packages. See
[the provider quickstart](getting-started.md) for selection and cleanup.

Use the commands in the catalog rather than guessing npm names. For example,
ComputeSDK's Cloudflare starter is `npm create cloudflare-sandbox`.

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
