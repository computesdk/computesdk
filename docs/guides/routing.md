# Routing and BYOK

ComputeSDK routes sandbox requests using your organization's saved Sandboxes router. Actions has a separate saved router. Choose a provider, configure fallback, or let the router select managed compute or your own provider accounts.

## Inspect before creating

```bash
compute sandboxes options
compute sandboxes route --size small
```

`options` shows managed capacity with offered sizes/rates and BYOK entries with readiness. `route` previews a concrete create, its account type and price. These commands create no sandbox and do not reserve capacity; the final placement can change if a provider refuses the request.

## Managed compute and your own keys

Managed compute runs under ComputeSDK-managed accounts and uses your organization's credits. BYOK runs under the provider credentials saved for your organization; the provider bills you directly.

| BYOK mode | Placement order |
| --- | --- |
| `off` | Managed accounts only |
| `first` | Own keys, then managed |
| `fallback` | Managed, then own keys |
| `only` | Own keys only |

The managed strategy is `computesdk` (recommended order), `cheapest` (price order for the requested size), or a custom order. Configure the saved router in the dashboard or through the [routing API](../platform/api-reference.md#routing). Owner/admin permissions are needed to change it.

## Narrow one CLI request

```bash
compute new daytona --managed
compute new e2b --byok
```

A provider choice narrows the saved router; `--managed` or `--byok` selects the account mode for this invocation. Neither changes organization settings. Check `compute sandboxes route --provider e2b --byok --size small` before creating.

Manage stored keys with `compute byok`, `compute byok configure <provider> --key <key>` and `compute byok verify <provider>`. Verification provisions a real sandbox. Multi-field providers use `--field name=value`. Reads are available to members; key writes need an owner/admin. A custom BYOK rate changes cost reporting, not billing.

## SDK and REST requests

A plain `sdk.instances.create()` using `platform({})` follows the saved router. The SDK's `providerOrder`, whether passed per call or set in provider `defaults`, bypasses that routing with the specified order. A call-level order takes precedence over `defaults.providerOrder`. Its legacy `'market'` entry requests market placement; an order with only provider names uses own keys. Price caps apply to market placement.

REST additionally supports per-request `only` and `byok`, documented in the [REST reference](../platform/api-reference.md#sandboxes). These are not typed `PlatformCreateOptions` fields. Do not assume that passing REST fields to the provider forwards them unchanged.

A published provider starter or benchmark listing does not establish access, available credit or capacity. Use options and route previews for your organization and requested size.
