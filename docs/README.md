---
description: Create sandboxes from your terminal or application with the ComputeSDK CLI and Platform SDK.
---

# Introduction

ComputeSDK runs your code in isolated cloud sandboxes. Start from your terminal with the **compute CLI**, or create and control sandboxes from TypeScript with the **Platform SDK**. Both use your organization's hosted routing, provider credentials and billing.

## Choose your starting point

| I want to… | Start here |
| --- | --- |
| Create a sandbox and run commands from my terminal | [CLI quickstart](getting-started/quick-start.md) |
| Create sandboxes from my application or AI agent | [Platform SDK quickstart](getting-started/sdk-quick-start.md) |
| Send a local project to a sandbox | [Project sync](cli/project-sync.md) |
| Choose managed compute or bring my own provider keys | [Routing and BYOK](guides/routing.md) |
| Run GitHub Actions workflows on sandbox providers | [Actions](platform/actions.md) |
| Give an AI assistant access through MCP | [MCP server](platform/mcp.md) |
| Call a provider directly without the hosted platform | [Direct providers](providers/README.md) |

## One platform, two ways to build

The CLI handles browser sign-in, sandbox selection, command execution, file transfers and project sync. The Platform SDK gives your code the same hosted sandbox lifecycle through `computesdk` and `@computesdk/platform`.

The platform routes requests across managed compute and your own provider keys. Managed compute uses your organization's ComputeSDK credits; BYOK compute is billed by the provider. [Check your route](guides/routing.md) before creating resources. A sandbox keeps running and billing until its lifetime expires or you destroy it.

Use the [dashboard](https://platform.computesdk.com) to manage organizations, credentials, credits and sandbox activity. REST and MCP expose additional platform operations alongside the CLI and SDK.

## Direct provider integrations

If you manage infrastructure and credentials in your own application, install individual provider adapters instead. The core SDK offers a common interface and client-side routing. Provider-native capabilities, adapter support and hosted availability are separate: a provider package does not guarantee that the platform can place work on it.

See the [provider catalog](providers/README.md), [direct provider setup](providers/getting-started.md) and [core SDK reference](reference/compute.md).
