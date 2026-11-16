# Platform SDK

Use the Platform SDK to run code in hosted sandboxes from a Node.js application. Install `computesdk` and `@computesdk/platform`: the first supplies the common instance interface; the second connects it to your ComputeSDK organization.

[Start with a runnable example](../getting-started/sdk-quick-start.md).

## What runs where

Your application sends sandbox requests to the platform. Server-side routing selects managed compute or your organization's provider keys, handles placement and tracks sandbox activity. Your application keeps a single platform sandbox ID and a consistent command/filesystem interface.

| Task | Guide |
| --- | --- |
| Create, execute and destroy | [SDK quickstart](../getting-started/sdk-quick-start.md) |
| Authenticate using a key or CLI session | [Authentication](../getting-started/authentication.md) |
| Configure sizes, commands, files and streaming | [Hosted sandboxes](../platform/sandboxes.md) |
| Choose managed compute or BYOK | [Routing](../guides/routing.md) |
| Handle limits, errors and uncertain creates | [Errors and retries](errors.md) |
| Understand exports and the lower-level client | [SDK reference](reference.md) |

## Hosted and direct providers

Use `platform({})` for hosted routing and organization-managed keys. Use a [direct provider adapter](../providers/README.md) when your application should call a vendor itself. Client-side core SDK routing and the platform's saved router are separate configurations.

The hosted provider supports sandbox operations; it does not imply that every platform REST endpoint has a dedicated typed SDK method. For Actions, benchmark and organization operations, use the CLI, REST API or the lower-level HTTP client where appropriate.
