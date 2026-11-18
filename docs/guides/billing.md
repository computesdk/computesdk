# Pricing and billing

Start with $5 in free compute credit. Managed compute uses your organization's
ComputeSDK credits; you do not need a provider account.

## Managed compute

Buy credits and run sandboxes or Actions workflows at the listed compute
rates. A 5% fee applies when purchasing credits. It is not charged again on
each usage charge, and there is no extra fee for running Actions workflows.

See the [current rate table](https://www.computesdk.com/pricing). Rates are shown
per hour for comparison; billing increments are listed separately when
available. Sandbox and Actions rates may differ.

Review placement and price without creating a sandbox:

```bash
compute sandboxes route --size small
```

A quote does not reserve capacity. Final placement depends on the available
route when the sandbox is created.

## Your own provider keys

You can connect provider keys to your organization. That provider bills its
compute usage directly. See [routing](routing.md) to choose how managed compute
and your own accounts are used.

## Stop charges when you finish

```bash
compute destroy
compute list
```

Destroying a sandbox releases its compute. Closing your terminal, finishing a
command or disconnecting from a preview does not destroy it. The sandbox's
lifetime also limits how long it runs. See [lifecycle](lifecycle.md).

Manage credit and payment settings in **Settings → Billing** in the
[dashboard](https://platform.computesdk.com).
