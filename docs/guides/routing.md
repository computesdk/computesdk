# Routing and provider selection

Let ComputeSDK route, choose a provider, or configure a fallback order. Routing
happens when a sandbox is created. A running sandbox stays on that provider;
changing preferences affects future placements.

## Let ComputeSDK choose

```bash
compute new
```

The saved Sandboxes router determines placement. Managed compute uses
ComputeSDK accounts and credits, so you do not need vendor credentials.
Actions has its own saved routing settings for workflow jobs.

## Choose a provider

```bash
compute new modal
```

A provider choice narrows the saved router for this request. It does not change
your organization's settings. If that provider cannot place the sandbox, the
request fails rather than silently choosing a different provider. See
[the catalog](../providers/README.md) for router IDs and npm starters.

## Define routing rules in the platform

Owners and admins can save routing rules for their organization in the
[dashboard](https://platform.computesdk.com):

1. Open **Settings → Sandboxes**.
2. In **Managed accounts**, choose a **Routing** strategy:
   - **ComputeSDK (recommended)** follows ComputeSDK's recommended provider order.
   - **Cheapest** tries the lowest price for the requested size first; different sizes can have different orders.
   - **Custom order** lets you choose and order the available managed accounts.
3. For **Custom order**, add, remove or reorder accounts, then click **Save order**.
4. To use managed accounts only, keep **Use BYOK accounts** set to **Off** where that control is shown.

For example, put Modal before E2B in a custom order if both are available to
your organization. Future creates try that order. Available accounts and
capacity determine which placements can succeed.

The SDK follows these saved rules with no per-request routing configuration:

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create();
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Saved rules also apply to unpinned CLI creates such as `compute new`. They are
shared organization settings, so changes affect other clients that follow the
router. They do not move running sandboxes. Explicit SDK `providerOrder`
values, including client defaults, bypass these rules.

Actions has a separate router under **Settings → Actions**, with the same
managed-routing strategies. Sandbox and workflow routing can be configured
independently. For programmatic configuration, use the
[routing API](../platform/api-reference.md#routing).

## Preview routing

Inspect the available options and a placement quote without creating compute:

```bash
compute sandboxes options
compute sandboxes route --provider modal --size small
```

`options` reports offered sizes, rates and account readiness. A quote does not
reserve capacity; final placement can change if capacity becomes unavailable.
See [billing](billing.md) for credits and rates.

## Optional: your own provider keys

Connect provider keys in your organization's settings or with `compute byok`.
The provider bills that compute directly. Managed and own-account compute use
the same sandbox interface.

| Mode | Placement order |
| --- | --- |
| `off` | Managed accounts only |
| `first` | Own keys, then managed |
| `fallback` | Managed, then own keys |
| `only` | Own keys only |

For one CLI invocation, use `compute new modal --managed` or
`compute new modal --byok`. Key writes need an owner or admin. Use
`compute byok --help` for configuration; verifying a key provisions real compute.

## SDK and REST overrides

`compute.instances.create()` follows saved routing by default. An explicit
`providerOrder` bypasses that routing. An order containing provider names uses
your organization's keys. Use one name, such as `providerOrder: ['modal']`,
to pin a provider without fallback, or several names for an explicit order.
See [SDK provider selection](../sdk/README.md#choose-a-provider) for a complete
example and managed-compute guidance.

```typescript
import { compute } from 'computesdk';

const sandbox = await compute.instances.create({
  providerOrder: ['modal', 'e2b'],
});
try {
  console.log((await sandbox.runCommand('echo hello')).stdout);
} finally {
  await sandbox.destroy();
}
```

Per-call `providerOrder` takes precedence over provider defaults; either
bypasses saved routing. Existing explicitly configured direct adapters also
bypass the router.

REST supports `only` and `byok` fields for one-request routing, documented in the
[REST reference](../platform/api-reference.md#sandboxes). These are HTTP fields;
they are not SDK create options. See the [SDK reference](../sdk/reference.md)
for the options supported by `compute.instances.create()`.
