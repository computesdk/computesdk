---
description: One router for sandboxes and Actions. Run code through the CLI, TypeScript SDK or API.
---

# ComputeSDK

ComputeSDK is one router for sandboxes and Actions. Run agent code and GitHub workflows across compute providers through one integration. Let ComputeSDK choose a provider, choose one yourself, or configure a fallback order.

Start from your terminal with the **CLI**, build with the **TypeScript SDK**, or connect an assistant through **MCP**. Use ComputeSDK-managed compute or bring your own provider keys.

## Choose your starting point

| I want to… | Start here |
| --- | --- |
| Create a sandbox and run commands from my terminal | [CLI quickstart](getting-started/quick-start.md) |
| Create sandboxes from my application or AI agent | [TypeScript SDK quickstart](getting-started/sdk-quick-start.md) |
| Start on Modal, E2B or another provider | [Choose a sandbox provider](providers/README.md) |
| Send a local project to a sandbox | [Project sync](cli/project-sync.md) |
| Choose managed compute or bring my own provider keys | [Routing and BYOK](guides/routing.md) |
| Run GitHub Actions workflows on sandbox providers | [Actions](platform/actions.md) |
| Give an AI assistant access through MCP | [MCP server](platform/mcp.md) |

## One router, several ways to run

The CLI handles browser sign-in, sandbox selection, command execution, file transfers and project sync. The TypeScript SDK gives your code the same sandbox lifecycle through `computesdk`.

ComputeSDK routes requests across managed compute and your own provider keys. Managed compute uses your organization's ComputeSDK credits; BYOK compute is billed by the provider. [Check your route](guides/routing.md) before creating resources. A sandbox keeps running and billing until its lifetime expires or you destroy it.

Use the [dashboard](https://platform.computesdk.com) to manage organizations, credentials, credits and sandbox activity. REST and MCP expose additional operations alongside the CLI and SDK.

## Build with ComputeSDK

Start with [installation](getting-started/installation.md), then follow the CLI or SDK quickstart to create your first sandbox. The [ComputeSDK overview](platform/README.md) explains organizations, authentication and the API. For application development, continue with [hosted sandboxes](platform/sandboxes.md) and the [SDK reference](sdk/reference.md).
