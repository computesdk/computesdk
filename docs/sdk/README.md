# TypeScript SDK

Use the TypeScript SDK to run code in hosted sandboxes from a Node.js application. Create sandboxes, execute commands and work with files through your ComputeSDK organization. The platform manages provider placement and credentials, so your application uses one API for managed compute and BYOK.

Install `computesdk` and call `compute.instances.create()` to get started.

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

## Other platform operations

The hosted provider supports sandbox operations; it does not imply that every platform REST endpoint has a dedicated typed SDK method. For Actions, benchmark and organization operations, use the CLI, REST API or the lower-level HTTP client where appropriate.
