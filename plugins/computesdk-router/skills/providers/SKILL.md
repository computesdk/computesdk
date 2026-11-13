---
name: providers
description: Check and manage the org's own provider (BYOK) keys and custom reporting rates in ComputeSDK — see which providers have a key, whether it works, what each provider costs, and verify, remove or re-rate a key. Use when the user asks about their provider keys, why a sandbox placed on a given provider, or what a provider costs.
---

# ComputeSDK providers (BYOK)

An org can bring its own key for a provider; sandboxes and Actions jobs then
place on it and bill the provider directly. Without a key, a provider's
sandboxes run on ComputeSDK's house account and bill from prepaid credit.

## Read

- `providers_list` — every provider the org may bring a key for: `regions`,
  the key's state (`status` connected / unconfigured / error, masked
  `keyHint`, `lastCheckedAt`, `statusDetail`) and its rates. `rate` is what
  sandbox costs are reported at, `customRate` is the org's own (or null),
  `platformRate` is the platform's. Quote prices to the user per hour.
- `providers_get` — the same for one provider.
- `actions_list_providers` — the providers Actions can place on and the
  effective `providerOrder`.

## Change (org owners/admins only)

- `providers_verify_key` places a real sandbox with the stored key to test it.
  It uses real compute: confirm first.
- `providers_remove_key` — new sandboxes and Actions jobs stop placing on that
  key. Live sandboxes keep the credential until they are destroyed. Confirm first.
- `providers_set_custom_rate` / `providers_clear_custom_rate` — the org's own
  reporting rate. It only changes how the org's costs are reported; it never
  changes what the platform charges.

## Rules

- A key value never passes through chat. There is no tool to read or set one:
  tell the user to add or rotate keys in the ComputeSDK dashboard
  or with `compute byok`.
- Never print, echo, or write secrets.
- A 403 with a permission message means the user is not an org owner/admin:
  say so, don't retry.
