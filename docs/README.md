---
description: Create sandboxes from your terminal or application with the ComputeSDK CLI and Platform SDK.
---

# ComputeSDK Platform

ComputeSDK is a hosted platform for running code in isolated cloud sandboxes. Start from your terminal with the **compute CLI**, or create and control sandboxes from TypeScript with the **Platform SDK**. Both use your organization's hosted routing, provider credentials and billing.

## Choose your starting point

| I want to… | Start here |
| --- | --- |
| Create a sandbox and run commands from my terminal | [CLI quickstart](getting-started/quick-start.md) |
| Create sandboxes from my application or AI agent | [Platform SDK quickstart](getting-started/sdk-quick-start.md) |
| Send a local project to a sandbox | [Project sync](cli/project-sync.md) |
| Choose managed compute or bring my own provider keys | [Routing and BYOK](guides/routing.md) |
| Run GitHub Actions workflows on sandbox providers | [Actions](platform/actions.md) |
| Give an AI assistant access through MCP | [MCP server](platform/mcp.md) |

## One platform, two ways to build

The CLI handles browser sign-in, sandbox selection, command execution, file transfers and project sync. The Platform SDK gives your code the same hosted sandbox lifecycle through `computesdk` and `@computesdk/platform`.

The platform routes requests across managed compute and your own provider keys. Managed compute uses your organization's ComputeSDK credits; BYOK compute is billed by the provider. [Check your route](guides/routing.md) before creating resources. A sandbox keeps running and billing until its lifetime expires or you destroy it.

Use the [dashboard](https://platform.computesdk.com) to manage organizations, credentials, credits and sandbox activity. REST and MCP expose additional platform operations alongside the CLI and SDK.

## Build on the platform

Start with [installation](getting-started/installation.md), then follow the CLI or SDK quickstart to create your first sandbox. The [platform overview](platform/README.md) explains organizations, authentication and the API. For application development, continue with [hosted sandboxes](platform/sandboxes.md) and the [SDK reference](sdk/reference.md).
