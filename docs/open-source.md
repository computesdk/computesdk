# Open-source SDK

The main getting-started guides use the hosted ComputeSDK Platform through the [CLI](getting-started/quick-start.md) and [Platform SDK](getting-started/sdk-quick-start.md). The platform handles placement, organization credentials and sandbox activity, including when you [bring your own provider keys](guides/routing.md).

Use the open-source SDK's direct provider adapters when your application needs to call and manage vendor APIs itself. You manage vendor credentials, routing and the sandbox lifecycle in your application. This is a separate integration path from platform BYOK.

## Direct integrations

Start with [direct provider setup](providers/getting-started.md), then choose an adapter from the [provider catalog](providers/README.md). Adapter capabilities and hosted platform availability are separate; the presence of an adapter does not imply that the platform can place work on that provider.

## Core SDK reference

These references describe the common interfaces used by direct adapters. For hosted application development, use the [Platform SDK reference](sdk/reference.md).

* [Instance interface](reference/Instance.md)
* [compute](reference/compute.md)
* [compute.instances](reference/compute.instances.md)
* [Sandbox sizes](reference/sizes.md)

## Contributing

For source development, custom providers and contribution instructions, see the [repository's open-source guide](https://github.com/computesdk/computesdk/blob/main/OPEN_SOURCE.md).
