# Direct providers

Use a direct provider adapter when your application should hold the vendor credentials and call that provider itself. Start with [direct provider setup](getting-started.md), then choose a provider from the sidebar.

For hosted routing and organization-managed credentials, use the [Platform SDK](../sdk/README.md) or [CLI quickstart](../getting-started/quick-start.md) instead. You do not need individual adapters for hosted sandboxes.

## Check the capability you need

Provider-native features, ComputeSDK adapter support and hosted placement are separate. Confirm the adapter's supported methods and limitations on its page. In particular, custom images, snapshots, live-memory snapshots, streaming and port URLs vary by provider. See [sandbox sizes](../reference/sizes.md) before using a common size tier with direct adapters.

The [core SDK reference](../reference/compute.md) explains client-side priority, round-robin and fallback routing. That configuration is separate from the hosted organization's saved router.
